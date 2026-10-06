import { assertCan } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { enqueueJob, systemPingJob } from "@forgecy/jobs";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getQueues } from "@/lib/queues";

/** Admin check that the queue and the worker answer: enqueues `system.ping` and returns 202. */
export const POST = withUser(async (user) => {
  assertCan(user.actor, "settings.manage");
  const job = await enqueueJob(getDb(), await getQueues(), {
    kind: systemPingJob,
    payload: { message: "ping" },
    createdBy: user.id,
  });
  return NextResponse.json({ jobId: job.id }, { status: 202 });
});
