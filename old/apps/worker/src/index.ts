import { JOB_LOCK_TTL_MS, loadEnv } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { maybeEnqueueNightlyBackup } from "@forgecy/backup";
import { createJobWorker, createQueues, recoverStaleJobs } from "@forgecy/jobs";
import { createMailer } from "@forgecy/mail";
import { createSocialRuntime, enqueueDueSnapshots } from "@forgecy/social";
import pino from "pino";
import { handlers } from "./handlers";
import { startHealthServer } from "./health";
import { sendNotificationEmails } from "./notification-emails";

const env = loadEnv();
const logger = pino({ level: env.FORGECY_LOG_LEVEL, base: { service: "worker" } });
const db = getDb();

const worker = await createJobWorker({ db, redisUrl: env.REDIS_URL, handlers, logger });
let running = true;

// Producer connection: used by crash recovery to put lost jobs back in Redis, and by the nightly backup.
const producer = await createQueues(env.REDIS_URL);

// Jobs left "running" by a crashed worker, and rows whose BullMQ job is gone, go back to the queue
// (or fail after the last attempt).
async function recover() {
  try {
    const { retried, failed, requeued } = await recoverStaleJobs(db, JOB_LOCK_TTL_MS, {
      queues: producer,
    });
    if (retried.length || failed.length || requeued.length)
      logger.warn({ retried, failed, requeued }, "recovered stale jobs");
  } catch (err) {
    logger.error({ err }, "stale job recovery failed");
  }
}
await recover();
const recoveryTimer = setInterval(recover, 60_000);

// Tonight's backup (Settings › Backup): checked every 10 minutes, enqueued once after 02:00.
async function nightly() {
  try {
    const jobId = await maybeEnqueueNightlyBackup(db, producer);
    if (jobId) logger.info({ jobId }, "nightly backup enqueued");
  } catch (err) {
    logger.error({ err }, "nightly backup check failed");
  }
}
await nightly();
const nightlyTimer = setInterval(nightly, 10 * 60_000);

// Notifications by email for the people who opted in: checked every minute, only with SMTP.
const mailer = createMailer(env, { logger });
async function notificationEmails() {
  try {
    const { sent, failed } = await sendNotificationEmails(db, mailer, env.FORGECY_BASE_URL);
    if (sent || failed) logger.info({ sent, failed }, "notification emails");
  } catch (err) {
    logger.error({ err }, "notification emails failed");
  }
}
const emailTimer = mailer.configured ? setInterval(notificationEmails, 60_000) : null;

// Monitored Instagram profiles that are due: checked every 5 minutes, each read staggered.
const social = createSocialRuntime(env);
async function socialTick() {
  try {
    const queued = await enqueueDueSnapshots(db, producer, social);
    if (queued) logger.info({ queued }, "social snapshots enqueued");
  } catch (err) {
    logger.error({ err }, "social snapshot scheduling failed");
  }
}
await socialTick();
const socialTimer = setInterval(socialTick, 5 * 60_000);

const health = startHealthServer(env.WORKER_HEALTH_PORT, db, () => running);
logger.info({ queues: worker.queues }, "worker ready");

async function shutdown(signal: string) {
  if (!running) return;
  running = false;
  logger.info({ signal }, "shutting down");
  clearInterval(recoveryTimer);
  clearInterval(nightlyTimer);
  clearInterval(socialTimer);
  if (emailTimer) clearInterval(emailTimer);
  mailer.close();
  health.close();
  await worker.close();
  await producer.close();
  await db.$client.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
