import "server-only";
import { createQueues, type JobQueues } from "@forgecy/jobs";
import { env } from "./env";

let queues: Promise<JobQueues> | undefined;

/** One producer connection per web process. */
export function getQueues(): Promise<JobQueues> {
  queues ??= createQueues(env.REDIS_URL);
  return queues;
}
