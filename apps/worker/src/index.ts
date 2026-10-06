import { JOB_LOCK_TTL_MS, loadEnv } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { createJobWorker, recoverStaleJobs } from "@forgecy/jobs";
import pino from "pino";
import { handlers } from "./handlers";
import { startHealthServer } from "./health";

const env = loadEnv();
const logger = pino({ level: env.FORGECY_LOG_LEVEL, base: { service: "worker" } });
const db = getDb();

const worker = await createJobWorker({ db, redisUrl: env.REDIS_URL, handlers, logger });
let running = true;

// Jobs left "running" by a crashed worker go back to the queue (or fail after the last attempt).
async function recover() {
  try {
    const { retried, failed } = await recoverStaleJobs(db, JOB_LOCK_TTL_MS);
    if (retried.length || failed.length) logger.warn({ retried, failed }, "recovered stale jobs");
  } catch (err) {
    logger.error({ err }, "stale job recovery failed");
  }
}
await recover();
const recoveryTimer = setInterval(recover, 60_000);

const health = startHealthServer(Number(process.env.WORKER_HEALTH_PORT ?? 3001), db, () => running);
logger.info({ queues: worker.queues }, "worker ready");

async function shutdown(signal: string) {
  if (!running) return;
  running = false;
  logger.info({ signal }, "shutting down");
  clearInterval(recoveryTimer);
  health.close();
  await worker.close();
  await db.$client.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
