"use server";

import { critiqueClaimsJob, getContentRow, humanOnly } from "@forgecy/content";
import { ForgecyError, PermissionDeniedError } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { enqueueJob } from "@forgecy/jobs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { errorMessage } from "@/lib/i18n";
import { getQueues } from "@/lib/queues";
import { requireUser } from "@/lib/session";
import type { ActionResult } from "./actions";

const input = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,80}$/),
  clientId: z.uuid(),
  contentId: z.uuid(),
});

/** “Check claims”: queues the advisory claim critic on the current draft. People only. */
export async function checkClaimsAction(raw: z.input<typeof input>): Promise<ActionResult> {
  const i = input.parse(raw);
  const user = await requireUser();
  const db = getDb();
  try {
    humanOnly(user.actor, "edit_draft", i.clientId);
    await getContentRow(db, i.clientId, i.contentId);
    await enqueueJob(db, await getQueues(), {
      kind: critiqueClaimsJob,
      payload: { clientId: i.clientId, contentId: i.contentId, requestedBy: user.id },
      clientId: i.clientId,
      entity: "content",
      entityId: i.contentId,
      createdBy: user.id,
    });
    revalidatePath(`/content/${i.slug}`, "layout");
    return { ok: true };
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof ForgecyError)
      return { ok: false, error: (await errorMessage(err)) ?? err.message };
    throw err;
  }
}
