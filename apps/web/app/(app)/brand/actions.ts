"use server";

import {
  acceptProposal,
  acceptProposals,
  addSource,
  approveAndPublish,
  brandImportSourceJob,
  ensureDraft,
  rejectProposals,
  removeSource,
  restoreAsDraft,
  returnToDraft,
  saveDraftSection,
  saveDraftTokens,
  submitForReview,
  type DocumentSectionKey,
  type TokenTree,
} from "@forgecy/brand";
import { assertCan, brandSourceKinds, ForgecyError, PermissionDeniedError } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { enqueueJob } from "@forgecy/jobs";
import { revalidatePath } from "next/cache";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";
import { errorMessage, firstIssue, vmsg } from "@/lib/i18n";
import { getQueues } from "@/lib/queues";
import { requireUser } from "@/lib/session";

export type ActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string; code?: string; details?: Record<string, unknown> };

async function run<T extends object>(
  slug: string,
  fn: (ctx: {
    actor: Awaited<ReturnType<typeof requireUser>>["actor"];
    userId: string;
  }) => Promise<T>,
): Promise<ActionResult<T>> {
  const user = await requireUser();
  try {
    const out = await fn({ actor: user.actor, userId: user.id });
    revalidatePath(`/brand/${slug}`, "layout");
    return { ok: true, ...out };
  } catch (err) {
    if (err instanceof PermissionDeniedError)
      return {
        ok: false,
        error: (await errorMessage(err)) ?? err.message,
        code: "PERM-DENIED",
      };
    if (err instanceof ForgecyError) {
      const code = typeof err.details?.code === "string" ? err.details.code : err.code;
      return {
        ok: false,
        error: (await errorMessage(err)) ?? err.message,
        code,
        ...(err.details ? { details: err.details } : {}),
      };
    }
    throw err;
  }
}

const slugSchema = z.string().regex(/^[a-z0-9-]{1,80}$/);
const uuid = z.uuid();

export async function startDraftAction(slug: string, clientId: string) {
  slugSchema.parse(slug);
  return run(slug, async ({ actor }) => {
    const v = await ensureDraft(getDb(), actor, uuid.parse(clientId));
    return { number: v.number };
  });
}

export async function saveSectionAction(input: {
  slug: string;
  clientId: string;
  versionId: string;
  rev: number;
  section: DocumentSectionKey;
  value: unknown;
}) {
  slugSchema.parse(input.slug);
  return run(input.slug, ({ actor }) =>
    saveDraftSection(getDb(), actor, {
      clientId: uuid.parse(input.clientId),
      versionId: uuid.parse(input.versionId),
      rev: input.rev,
      section: input.section,
      value: input.value,
    }),
  );
}

export async function saveTokensAction(input: {
  slug: string;
  clientId: string;
  versionId: string;
  rev: number;
  tokens: TokenTree;
}) {
  slugSchema.parse(input.slug);
  return run(input.slug, ({ actor }) =>
    saveDraftTokens(getDb(), actor, {
      clientId: uuid.parse(input.clientId),
      versionId: uuid.parse(input.versionId),
      rev: input.rev,
      tokens: input.tokens,
    }),
  );
}

export async function submitAction(input: {
  slug: string;
  clientId: string;
  versionId: string;
  rev: number;
}) {
  slugSchema.parse(input.slug);
  return run(input.slug, async ({ actor }) => {
    await submitForReview(getDb(), actor, input);
    return {};
  });
}

export async function returnToDraftAction(input: {
  slug: string;
  clientId: string;
  versionId: string;
  comment?: string;
}) {
  slugSchema.parse(input.slug);
  return run(input.slug, async ({ actor }) => {
    await returnToDraft(getDb(), actor, input);
    return {};
  });
}

export async function acceptProposalAction(input: {
  slug: string;
  clientId: string;
  proposalId: string;
  note?: string;
  editedValue?: unknown;
}) {
  slugSchema.parse(input.slug);
  return run(input.slug, ({ actor }) =>
    acceptProposal(getDb(), actor, {
      clientId: uuid.parse(input.clientId),
      proposalId: uuid.parse(input.proposalId),
      ...(input.note ? { note: input.note } : {}),
      ...(input.editedValue !== undefined ? { editedValue: input.editedValue } : {}),
    }),
  );
}

export async function acceptManyAction(input: {
  slug: string;
  clientId: string;
  proposalIds: string[];
}) {
  slugSchema.parse(input.slug);
  return run(input.slug, ({ actor }) =>
    acceptProposals(getDb(), actor, {
      clientId: uuid.parse(input.clientId),
      proposalIds: z.array(uuid).max(50).parse(input.proposalIds),
    }),
  );
}

export async function rejectAction(input: {
  slug: string;
  clientId: string;
  proposalIds: string[];
  note?: string;
}) {
  slugSchema.parse(input.slug);
  return run(input.slug, ({ actor }) =>
    rejectProposals(getDb(), actor, {
      clientId: uuid.parse(input.clientId),
      proposalIds: z.array(uuid).max(50).parse(input.proposalIds),
      ...(input.note ? { note: input.note } : {}),
    }),
  );
}

export async function publishAction(input: {
  slug: string;
  clientId: string;
  versionId: string;
  rev: number;
  changelog: string;
  note?: string;
  acknowledged: string[];
}) {
  slugSchema.parse(input.slug);
  return run(input.slug, ({ actor }) =>
    approveAndPublish(getDb(), actor, {
      clientId: uuid.parse(input.clientId),
      versionId: uuid.parse(input.versionId),
      rev: input.rev,
      changelog: input.changelog,
      ...(input.note ? { note: input.note } : {}),
      acknowledged: z.array(z.string().max(200)).max(200).parse(input.acknowledged),
    }),
  );
}

export async function restoreAction(input: {
  slug: string;
  clientId: string;
  versionId: string;
  replaceDraft?: boolean;
}) {
  slugSchema.parse(input.slug);
  return run(input.slug, async ({ actor }) => {
    const v = await restoreAsDraft(getDb(), actor, {
      clientId: uuid.parse(input.clientId),
      versionId: uuid.parse(input.versionId),
      ...(input.replaceDraft ? { replaceDraft: true } : {}),
    });
    return { number: v.number };
  });
}

const linkSourceSchema = z.object({
  kind: z.enum(brandSourceKinds),
  title: z.string().trim().min(1, vmsg("brand.validation.titleRequired")).max(300),
  url: z
    .string()
    .trim()
    .transform((v) => v || undefined)
    .pipe(
      z.url({ protocol: /^https?$/, message: vmsg("brand.validation.addressInvalid") }).optional(),
    ),
  note: z.string().trim().max(20_000).optional(),
});

/** A source without a file: a link (site, social profile) or a note typed by a person. */
export async function addLinkSourceAction(input: {
  slug: string;
  clientId: string;
  kind: string;
  title: string;
  url?: string;
  note?: string;
}) {
  slugSchema.parse(input.slug);
  const parsed = linkSourceSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: await firstIssue(parsed.error) };
  if (!parsed.data.url && !parsed.data.note)
    return {
      ok: false as const,
      error: (await getTranslations("brand.validation"))("addressOrNote"),
    };
  return run(input.slug, async ({ actor }) => {
    const row = await addSource(getDb(), actor, {
      clientId: uuid.parse(input.clientId),
      kind: parsed.data.kind,
      title: parsed.data.title,
      url: parsed.data.url ?? null,
      note: parsed.data.note ?? null,
      ...(parsed.data.note ? { pages: [{ locator: "Note", text: parsed.data.note }] } : {}),
      status: "extracted",
    });
    return { sourceId: row.id };
  });
}

export async function removeSourceAction(input: {
  slug: string;
  clientId: string;
  sourceId: string;
}) {
  slugSchema.parse(input.slug);
  return run(input.slug, ({ actor }) =>
    removeSource(getDb(), actor, {
      clientId: uuid.parse(input.clientId),
      sourceId: uuid.parse(input.sourceId),
    }),
  );
}

/** Reads the source again (after a failure or to ask the Brand Analyst again). */
export async function importSourceAction(input: {
  slug: string;
  clientId: string;
  sourceId: string;
}) {
  slugSchema.parse(input.slug);
  return run(input.slug, async ({ actor, userId }) => {
    assertCan(actor, "edit_draft", input.clientId);
    const job = await enqueueJob(getDb(), await getQueues(), {
      kind: brandImportSourceJob,
      payload: {
        clientId: uuid.parse(input.clientId),
        sourceId: uuid.parse(input.sourceId),
        requestedBy: userId,
        language: await getLocale(),
      },
      clientId: input.clientId,
      entity: "brand_source",
      entityId: input.sourceId,
      createdBy: userId,
    });
    return { jobId: job.id };
  });
}
