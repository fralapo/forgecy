import "server-only";
import { templateValidateJob } from "@forgecy/carousel";
import { getDb } from "@forgecy/db";
import { enqueueJob } from "@forgecy/jobs";
import { getQueues } from "@/lib/queues";
import type { CurrentUser } from "@/lib/session";

/** Static validation ran at import; the worker adds the render checks and saves the report. */
export async function enqueueTemplateValidation(
  user: CurrentUser,
  templateRowId: string,
  publishNotes?: string,
) {
  await enqueueJob(getDb(), await getQueues(), {
    kind: templateValidateJob,
    payload: {
      templateRowId,
      ...(publishNotes ? { publish: { by: user.id, notes: publishNotes } } : {}),
    },
    entity: "template",
    entityId: templateRowId,
    createdBy: user.id,
  });
}
