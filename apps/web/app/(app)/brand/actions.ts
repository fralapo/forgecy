"use server";

import {
  acceptProposal,
  acceptProposals,
  addSource,
  approveAndPublish,
  brandCrawlWebsiteJob,
  brandImportSourceJob,
  ensureDraft,
  findOrCreateSocialSource,
  findOrCreateWebsiteSource,
  linkSourceReader,
  rejectProposals,
  removeSource,
  restoreAsDraft,
  returnToDraft,
  undoImport,
  saveDraftSection,
  saveDraftTokens,
  submitForReview,
  type DocumentSectionKey,
  type TokenTree,
} from "@forgecy/brand";
import {
  approveClientBook,
  bookSections,
  brandSystemParts,
  createClientBook,
  exportBrandSystem,
  exportClientBook,
  rerenderClientBook,
} from "@forgecy/brand-book";
import {
  assertCan,
  brandSourceKinds,
  localeSchema,
  ForgecyError,
  PermissionDeniedError,
  socialChannels,
} from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { createStorageFromEnv } from "@forgecy/files";
import { englishMessage, messageRef } from "@forgecy/i18n";
import { enqueueJob } from "@forgecy/jobs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";
import { nameFromUrl } from "@/lib/brand-name";
import { createClientFor } from "@/lib/create-client";
import { env } from "@/lib/env";
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

const brandUrlSchema = z.object({
  url: z
    .string()
    .trim()
    .max(2048, vmsg("validation.websiteInvalid"))
    .pipe(z.url({ protocol: /^https?$/, message: vmsg("validation.websiteInvalid") })),
});
const brandNameSchema = z.object({
  name: z.string().trim().min(1, vmsg("validation.nameRequired")).max(120),
});

/**
 * "Add a brand": a website address (the name comes from its host) or just a name. Creates the
 * client the way "New client" does; with an address its first scan is queued as this person, so
 * the import applies itself (ADR 0022). Then opens the new brand, where the import shows.
 */
export async function addBrandFromUrlAction(input: { url: string } | { name: string }) {
  const user = await requireUser();
  assertCan(user.actor, "project.edit");
  const parsed =
    "url" in input ? brandUrlSchema.safeParse(input) : brandNameSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: await firstIssue(parsed.error) };
  const created = await createClientFor(
    user,
    "url" in parsed.data
      ? { name: nameFromUrl(parsed.data.url), status: "prospect", websiteUrl: parsed.data.url }
      : { name: parsed.data.name, status: "prospect" },
  );
  revalidatePath("/brand");
  revalidatePath("/clients");
  redirect(`/brand/${created.slug}`);
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
  return run(input.slug, async ({ actor, userId }) => {
    const db = getDb();
    const clientId = uuid.parse(input.clientId);
    const reader = linkSourceReader(parsed.data.kind, parsed.data.url);
    if (!reader) {
      // A link given as a profile of a network that is not a profile there is kept, not read.
      const notProfile =
        !!parsed.data.url && (socialChannels as readonly string[]).includes(parsed.data.kind);
      const row = await addSource(db, actor, {
        clientId,
        kind: parsed.data.kind,
        title: parsed.data.title,
        url: parsed.data.url ?? null,
        note: parsed.data.note ?? null,
        ...(parsed.data.note ? { pages: [{ locator: "Note", text: parsed.data.note }] } : {}),
        status: notProfile ? "partial" : "extracted",
        ...(notProfile
          ? {
              statusDetail: englishMessage("brand.import.status.linkNotProfile"),
              statusDetailRef: [messageRef("brand.import.status.linkNotProfile")],
            }
          : {}),
      });
      return { sourceId: row.id };
    }
    // A site or a public profile is read now, as this person: the import applies itself with
    // them as approver (ADR 0022). The note stays on the source, not among the pages read.
    assertCan(actor, "edit_draft", clientId);
    // A profile the import already found (or added before) is the same source, read again.
    const { source, created } =
      reader.job === "crawl"
        ? {
            source: await findOrCreateWebsiteSource(db, actor, {
              clientId,
              websiteUrl: reader.url,
            }),
            created: true,
          }
        : await findOrCreateSocialSource(db, actor, {
            clientId,
            kind: reader.kind,
            url: reader.url,
            title: parsed.data.title,
            note: parsed.data.note ?? null,
          });
    // A profile already queued or being read: that run reads it.
    if (!created && (source.status === "pending" || source.status === "extracting"))
      return { sourceId: source.id };
    await enqueueJob(db, await getQueues(), {
      kind: reader.job === "crawl" ? brandCrawlWebsiteJob : brandImportSourceJob,
      payload: { clientId, sourceId: source.id, requestedBy: userId, language: await getLocale() },
      clientId,
      entity: "brand_source",
      entityId: source.id,
      createdBy: userId,
    });
    return { sourceId: source.id };
  });
}

/**
 * "Undo import": goes back to the version before the last automatic import. When a draft is
 * open the result carries `code: "DRAFT-EXISTS"` and the person confirms replacing it.
 */
export async function undoImportAction(input: {
  slug: string;
  clientId: string;
  versionId: string;
  replaceDraft?: boolean;
}) {
  slugSchema.parse(input.slug);
  return run(input.slug, async ({ actor }) => {
    const v = await undoImport(getDb(), actor, {
      clientId: uuid.parse(input.clientId),
      versionId: uuid.parse(input.versionId),
      ...(input.replaceDraft ? { replaceDraft: true } : {}),
    });
    return { versionId: v.versionId };
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

/** Crawls an existing `website` source again (first scan, or a re-scan). */
export async function crawlSourceAction(input: {
  slug: string;
  clientId: string;
  sourceId: string;
}) {
  slugSchema.parse(input.slug);
  return run(input.slug, async ({ actor, userId }) => {
    assertCan(actor, "edit_draft", input.clientId);
    const job = await enqueueJob(getDb(), await getQueues(), {
      kind: brandCrawlWebsiteJob,
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

/** Starts the first scan of the client's website for a client that has no `website` source yet. */
export async function scanWebsiteAction(input: {
  slug: string;
  clientId: string;
  websiteUrl: string;
}) {
  slugSchema.parse(input.slug);
  const websiteUrl = z
    .url({ protocol: /^https?$/, message: vmsg("brand.validation.addressInvalid") })
    .parse(input.websiteUrl);
  return run(input.slug, async ({ actor, userId }) => {
    assertCan(actor, "edit_draft", input.clientId);
    const db = getDb();
    const source = await findOrCreateWebsiteSource(db, actor, {
      clientId: uuid.parse(input.clientId),
      websiteUrl,
    });
    const job = await enqueueJob(db, await getQueues(), {
      kind: brandCrawlWebsiteJob,
      payload: {
        clientId: uuid.parse(input.clientId),
        sourceId: source.id,
        requestedBy: userId,
        language: await getLocale(),
      },
      clientId: input.clientId,
      entity: "brand_source",
      entityId: source.id,
      createdBy: userId,
    });
    return { jobId: job.id, sourceId: source.id };
  });
}

/** Builds the Internal Brand System ZIP (stored and listed as BB-n). */
export async function exportBrandSystemAction(input: {
  slug: string;
  clientId: string;
  versionId: string;
  parts: string[];
}) {
  slugSchema.parse(input.slug);
  const parts = z.array(z.enum(brandSystemParts)).min(1).max(20).parse(input.parts);
  return run(input.slug, async ({ actor }) => {
    const row = await exportBrandSystem(
      { db: getDb(), storage: createStorageFromEnv(env) },
      actor,
      { clientId: uuid.parse(input.clientId), versionId: uuid.parse(input.versionId), parts },
    );
    return { number: row.number };
  });
}

export async function createClientBookAction(input: {
  slug: string;
  clientId: string;
  versionId: string;
  sections: string[];
  language: string;
}) {
  slugSchema.parse(input.slug);
  const sections = z.array(z.enum(bookSections)).min(1).max(10).parse(input.sections);
  const language = localeSchema.parse(input.language);
  return run(input.slug, async ({ actor }) => {
    const row = await createClientBook({ db: getDb(), queues: await getQueues() }, actor, {
      clientId: uuid.parse(input.clientId),
      versionId: uuid.parse(input.versionId),
      sections,
      language,
    });
    return { number: row.number };
  });
}

export async function rerenderClientBookAction(input: {
  slug: string;
  clientId: string;
  exportId: string;
}) {
  slugSchema.parse(input.slug);
  return run(input.slug, async ({ actor }) => {
    await rerenderClientBook({ db: getDb(), queues: await getQueues() }, actor, {
      clientId: uuid.parse(input.clientId),
      exportId: uuid.parse(input.exportId),
    });
    return {};
  });
}

export async function approveClientBookAction(input: {
  slug: string;
  clientId: string;
  exportId: string;
  note: string;
}) {
  slugSchema.parse(input.slug);
  const note = z.string().max(2000).parse(input.note);
  return run(input.slug, async ({ actor }) => {
    await approveClientBook(getDb(), actor, {
      clientId: uuid.parse(input.clientId),
      exportId: uuid.parse(input.exportId),
      note,
    });
    return {};
  });
}

export async function exportClientBookAction(input: {
  slug: string;
  clientId: string;
  exportId: string;
}) {
  slugSchema.parse(input.slug);
  return run(input.slug, async ({ actor }) => {
    await exportClientBook({ db: getDb(), queues: await getQueues() }, actor, {
      clientId: uuid.parse(input.clientId),
      exportId: uuid.parse(input.exportId),
    });
    return {};
  });
}
