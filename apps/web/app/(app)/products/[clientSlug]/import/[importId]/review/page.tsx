import {
  approvalBlockers,
  describeSource,
  emptyFields,
  importReview,
  itemTab,
  pendingSensitive,
  rowToFields,
  type FieldMetaMap,
  type ImageRef,
  type ProductDraft,
  type SourceRef,
} from "@forgecy/catalog";
import { getDb } from "@forgecy/db";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Breadcrumb, ImportStatusBadge } from "../../../../_components/ui";
import { importTitle, longDate } from "../../../../_lib/labels";
import { paths } from "../../../../_lib/paths";
import { catalogPage, imageUrl } from "../../../../_lib/server";
import { NotAClient } from "../../../not-a-client";
import { ReviewView, type ReviewItemView, type ReviewImageView } from "./review-view";

export const metadata = { title: "Rivedi import" };

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string; importId: string }>;
  searchParams: Promise<{ tab?: string; item?: string }>;
}) {
  const { clientSlug, importId } = await params;
  const sp = await searchParams;
  const { client } = await catalogPage(clientSlug);
  if (client.status !== "active") return <NotAClient name={client.name} />;
  if (!/^[0-9a-f-]{36}$/i.test(importId)) notFound();
  const review = await importReview(getDb(), client.id, importId);
  if (!review) notFound();
  const { imp, items, files, matches, approvers } = review;
  if (["uploading", "analyzing", "needs_mapping"].includes(imp.status))
    redirect(paths.importOpen(client.slug, imp.id));

  const fileById = new Map(files.map((f) => [f.id, f]));
  const urlFor = (fileId: string) => imageUrl(fileById.get(fileId)?.storageKey);
  const itemNames = new Map(items.map((i) => [i.id, (i.draft as ProductDraft).name ?? ""]));

  const views: ReviewItemView[] = await Promise.all(
    items.map(async (i) => {
      const draft = i.draft as ProductDraft;
      const meta = i.fieldMeta as FieldMetaMap;
      const match = i.matchProductId ? matches.get(i.matchProductId) : undefined;
      const images = await Promise.all(
        (i.images as unknown as ImageRef[]).map(async (r) => ({
          fileId: r.fileId,
          name: fileById.get(r.fileId)?.path ?? "",
          url: await urlFor(r.fileId),
          method: r.method,
          confidence: r.confidence,
        })),
      );
      return {
        id: i.id,
        tab: itemTab(i),
        status: i.status,
        name: draft.name ?? "",
        sku: draft.sku ?? null,
        category: draft.category ?? null,
        confidence: i.confidence,
        sensitive: i.sensitive,
        byAgent: i.proposedByAgent,
        origin: describeSource(i.origin as unknown as SourceRef),
        fields: { ...emptyFields(), ...draft },
        meta: Object.fromEntries(
          Object.entries(meta).map(([k, m]) => [
            k,
            m && {
              truth: m.truth,
              confidence: m.confidence,
              source: describeSource(m.source),
              sensitive: m.sensitive ?? [],
              accepted: !!m.acceptedBy,
            },
          ]),
        ),
        pendingSensitive: pendingSensitive(draft, meta),
        blockers: approvalBlockers(draft, meta),
        images,
        match: match
          ? {
              id: match.id,
              name: match.name,
              status: match.status,
              fields: rowToFields(match),
              approvedBy: match.approvedBy ? (approvers[match.approvedBy] ?? null) : null,
              approvedAt: match.approvedAt ? longDate(match.approvedAt) : null,
              href: paths.product(client.slug, match.id),
            }
          : null,
        matchReason: i.matchReason,
        conflicts: i.conflicts as unknown as Array<{
          field: string;
          approved: unknown;
          incoming: unknown;
        }>,
        decisions: (i.conflictDecisions ?? {}) as Record<string, string>,
        discardReason: i.discardReason,
        productHref: i.productId ? paths.product(client.slug, i.productId) : null,
      };
    }),
  );

  const unassigned: ReviewImageView[] = await Promise.all(
    files
      .filter((f) => f.kind === "image" && f.valid && f.imageState === "unassigned")
      .map(async (f) => {
        const s = f.suggestion as {
          itemId?: string;
          name?: string;
          confidence?: "high" | "medium" | "low";
        } | null;
        return {
          id: f.id,
          name: f.path,
          url: await imageUrl(f.storageKey),
          suggestion:
            s?.itemId && itemNames.has(s.itemId)
              ? {
                  itemId: s.itemId,
                  name: s.name ?? itemNames.get(s.itemId)!,
                  confidence: s.confidence ?? "low",
                }
              : null,
        };
      }),
  );

  const sourceNames = files
    .filter((f) => !f.parentId)
    .map((f) => f.name)
    .slice(0, 4)
    .join(", ");
  const tab = ["new", "duplicates", "conflicts", "images", "discarded"].includes(sp.tab ?? "")
    ? (sp.tab as ReviewItemView["tab"] | "images")
    : "new";

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Clienti", href: "/clients" },
          { label: client.name, href: "/products" },
          { label: "Prodotti", href: paths.catalog(client.slug) },
          { label: importTitle(imp.createdAt), href: paths.importOpen(client.slug, imp.id) },
          { label: "Revisione" },
        ]}
      />
      <PageHeader
        title="Rivedi import"
        description={sourceNames}
        actions={<ImportStatusBadge status={imp.status} />}
      />
      <ReviewView
        clientId={client.id}
        clientName={client.name}
        clientSlug={client.slug}
        importId={imp.id}
        open={imp.status === "ready_for_review"}
        items={views}
        images={unassigned}
        initialTab={tab}
        initialItem={sp.item ?? null}
        discardsHref={paths.discards(client.slug, imp.id)}
        importHref={paths.importOpen(client.slug, imp.id)}
        catalogHref={paths.catalog(client.slug, `import=${imp.id}`)}
      />
    </>
  );
}
