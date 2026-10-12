import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import type { SectionUi } from "../_lib/editor-config";
import { brandPath } from "../_lib/labels";
import { pendingByField } from "../_lib/pending";
import { loadBrand, shownVersion, sourcesFor } from "../_lib/server";
import { SectionEditor } from "./section-editor";

/** A block page (Strategy, Verbal, Visual, Content): the draft, or a version read-only. */
export async function BlockPage({
  slug,
  version,
  sections,
  intro,
  before,
}: {
  slug: string;
  version?: number | undefined;
  sections: SectionUi[];
  intro: string;
  before?: (
    ctx: Awaited<ReturnType<typeof loadBrand>> & { shown: ReturnType<typeof shownVersion> },
  ) => ReactNode;
}) {
  const t = await getTranslations("brand.block");
  const ctx = await loadBrand(slug);
  const { client, user, ws } = ctx;
  const shown = shownVersion(ws, version);
  const [sources, pending] = await Promise.all([
    sourcesFor(client.id),
    pendingByField(user.actor, client.id),
  ]);
  const doc = shown.document as unknown as Record<string, unknown>;
  const initial = Object.fromEntries(sections.map((s) => [s.section, doc[s.section]]));
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-body-md text-fg-muted">
        {intro}{" "}
        {shown.version && !shown.editable
          ? t("readOnly", { number: shown.version.number })
          : !shown.version
            ? t("startDraft")
            : ""}
      </p>
      {before?.({ ...ctx, shown })}
      <SectionEditor
        key={shown.version?.id ?? "none"}
        sections={sections}
        initial={initial}
        editable={shown.editable}
        slug={client.slug}
        clientId={client.id}
        versionId={shown.editable ? shown.version!.id : null}
        rev={shown.version?.rev ?? 0}
        sources={sources.map((s) => ({ id: s.id, title: s.title }))}
        pending={pending}
        proposalsHref={brandPath(client.slug, "proposals")}
      />
    </div>
  );
}
