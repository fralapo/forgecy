"use server";

import {
  acceptAdaptation,
  adaptChannelJob,
  adaptChannelSchema,
  dismissAdaptation,
  getContentRow,
  humanOnly,
} from "@forgecy/content";
import { ForgecyError, PermissionDeniedError } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { enqueueJob } from "@forgecy/jobs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { errorMessage } from "@/lib/i18n";
import { getQueues } from "@/lib/queues";
import { requireUser } from "@/lib/session";
import type { ActionResult } from "./actions";

const base = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,80}$/),
  clientId: z.uuid(),
});
const askInput = base.extend({ contentId: z.uuid(), channel: adaptChannelSchema });
const answerInput = base.extend({ jobId: z.uuid() });

async function failure(err: unknown): Promise<{ ok: false; error: string }> {
  if (err instanceof PermissionDeniedError || err instanceof ForgecyError)
    return { ok: false, error: (await errorMessage(err)) ?? err.message };
  throw err;
}

/** “Propose for LinkedIn / Facebook”: queues the adaptation of an Instagram carousel. People only. */
export async function askAdaptationAction(raw: z.input<typeof askInput>): Promise<ActionResult> {
  const i = askInput.parse(raw);
  const user = await requireUser();
  const db = getDb();
  try {
    humanOnly(user.actor, "edit_draft", i.clientId);
    await getContentRow(db, i.clientId, i.contentId);
    await enqueueJob(db, await getQueues(), {
      kind: adaptChannelJob,
      payload: {
        clientId: i.clientId,
        contentId: i.contentId,
        channel: i.channel,
        requestedBy: user.id,
      },
      clientId: i.clientId,
      entity: "content",
      entityId: i.contentId,
      createdBy: user.id,
    });
    revalidatePath(`/content/${i.slug}`, "layout");
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/** “Accept”: the proposal becomes a new draft content for the channel. Returns its id. */
export async function acceptAdaptationAction(
  raw: z.input<typeof answerInput>,
): Promise<ActionResult<{ contentId: string }>> {
  const i = answerInput.parse(raw);
  const user = await requireUser();
  const db = getDb();
  try {
    const created = await acceptAdaptation(db, user.actor, {
      clientId: i.clientId,
      jobId: i.jobId,
    });
    revalidatePath(`/content/${i.slug}`, "layout");
    return { ok: true, contentId: created.id };
  } catch (err) {
    return failure(err);
  }
}

/** “Dismiss”: the proposal is answered and nothing is created. */
export async function dismissAdaptationAction(
  raw: z.input<typeof answerInput>,
): Promise<ActionResult> {
  const i = answerInput.parse(raw);
  const user = await requireUser();
  const db = getDb();
  try {
    await dismissAdaptation(db, user.actor, { clientId: i.clientId, jobId: i.jobId });
    revalidatePath(`/content/${i.slug}`, "layout");
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}
