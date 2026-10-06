import {
  approvalBlockerList,
  fieldDefs,
  formatValue,
  pendingSensitive,
  productDetail,
  type FieldKey,
  type FieldMetaMap,
  type SourceRef,
} from "@forgecy/catalog";
import { getDb } from "@forgecy/db";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { getFormat } from "@/lib/i18n";
import { ProductStatusBadge, Breadcrumb } from "../../_components/ui";
import { blockerText, fieldLabel, sourceText } from "../../_lib/labels";
import { paths } from "../../_lib/paths";
import { catalogPage, getStorage, imageUrl } from "../../_lib/server";
import { NotAClient } from "../not-a-client";
import { ProductView, type ProductViewData } from "./product-view";

export async function generateMetadata() {
  const t = await getTranslations("products");
  return { title: t("product.title") };
}

const historyActions = [
  "create",
  "create_from_import",
  "update",
  "approve",
  "reject",
  "archive",
  "restore",
  "to_draft",
  "duplicate",
  "sensitive_accept",
  "field_proposal_accepted",
  "field_proposal_rejected",
  "image_add",
  "image_primary",
  "image_unlink",
  "image_approve",
  "image_alt",
] as const;
type HistoryAction = (typeof historyActions)[number];

const isFieldKey = (k: unknown): k is FieldKey =>
  typeof k === "string" && fieldDefs.some((f) => f.key === k);

export default async function ProductPage({
  params,
}: {
  params: Promise<{ clientSlug: string; productId: string }>;
}) {
  const { clientSlug, productId } = await params;
  const { client } = await catalogPage(clientSlug);
  if (client.status !== "active") return <NotAClient name={client.name} />;
  if (!/^[0-9a-f-]{36}$/i.test(productId)) notFound();
  const detail = await productDetail(getDb(), client.id, productId);
  if (!detail) notFound();
  const { product, fields } = detail;
  const meta = (product.fieldMeta ?? {}) as FieldMetaMap;
  const storage = getStorage();
  const t = await getTranslations("products");
  const format = await getFormat();
  const longDate = (d: Date) => format.date(d, "dateTime");
  const historyLabel = (action: string) => {
    const key = action.replace(/^product\./, "");
    return (historyActions as readonly string[]).includes(key)
      ? t(`product.history.${key as HistoryAction}`)
      : action;
  };

  const data: ProductViewData = {
    clientId: client.id,
    clientSlug: client.slug,
    clientName: client.name,
    id: product.id,
    name: product.name,
    status: product.status,
    revision: product.revision,
    byAgent: product.proposedByAgent,
    fields,
    meta: Object.fromEntries(
      Object.entries(meta).map(([k, m]) => [
        k,
        m && {
          truth: m.truth,
          confidence: m.confidence,
          source: sourceText(t, m.source),
          byAgent: m.source.kind === "ai",
          sensitive: m.sensitive ?? [],
          accepted: !!m.acceptedBy,
          page: m.source.page ?? null,
          fileId: m.source.fileId ?? null,
        },
      ]),
    ),
    blockers: approvalBlockerList(fields, meta).map((b) => blockerText(t, b)),
    pendingSensitive: pendingSensitive(fields, meta),
    images: await Promise.all(
      detail.images.map(async (i) => ({
        id: i.id,
        url: await imageUrl(i.storageKey),
        alt: i.alt ?? product.name,
        fileName: i.fileName,
        status: i.status,
        isPrimary: i.isPrimary,
        method: i.matchMethod,
        confidence: i.confidence,
      })),
    ),
    proposals: detail.proposals.map(({ pr, decidedByName }) => ({
      id: pr.id,
      field: pr.field as FieldKey,
      label: isFieldKey(pr.field) ? fieldLabel(t, pr.field) : pr.field,
      current: formatValue(pr.field as FieldKey, pr.currentValue),
      proposed: formatValue(pr.field as FieldKey, pr.proposedValue),
      proposedRaw: pr.proposedValue,
      source: (pr.meta as { source?: SourceRef } | null)?.source
        ? sourceText(t, (pr.meta as { source: SourceRef }).source)
        : t("breadcrumb.import"),
      status: pr.status,
      when: longDate(pr.createdAt),
      decidedBy: decidedByName,
    })),
    history: detail.history.map(({ e, userName }) => ({
      id: String(e.id),
      label: historyLabel(e.action),
      who: userName ?? (e.actor.startsWith("agent") ? t("product.agent") : t("product.system")),
      when: longDate(e.at),
      field: isFieldKey(e.meta?.field) ? fieldLabel(t, e.meta.field) : null,
      note: typeof e.meta?.note === "string" ? e.meta.note : null,
    })),
    sources: [
      ...(detail.sourceImport
        ? [
            {
              label: t("product.importOf", { date: longDate(detail.sourceImport.createdAt) }),
              href: paths.review(client.slug, detail.sourceImport.id),
              external: false,
            },
          ]
        : []),
      ...(await Promise.all(
        detail.pdfSources
          .filter((f) => f.storageKey)
          .map(async (f) => ({
            label: t("product.pdfSource", { name: f.name }),
            href: await storage.signedUrl(f.storageKey!, { expiresInSeconds: 900 }),
            external: true,
            fileId: f.id,
          })),
      )),
    ],
    approvedBy: product.approvedBy ? (detail.userNames[product.approvedBy] ?? null) : null,
    approvedAt: product.approvedAt ? longDate(product.approvedAt) : null,
    createdBy: product.createdBy ? (detail.userNames[product.createdBy] ?? null) : null,
    sourceImportHref: detail.sourceImport
      ? paths.review(client.slug, detail.sourceImport.id)
      : null,
  };

  return (
    <>
      <Breadcrumb
        items={[
          { label: t("breadcrumb.clients"), href: "/clients" },
          { label: client.name, href: "/products" },
          { label: t("breadcrumb.products"), href: paths.catalog(client.slug) },
          { label: product.name },
        ]}
      />
      <PageHeader
        title={product.name}
        description={product.sku ?? undefined}
        actions={<ProductStatusBadge status={product.status} byAgent={product.proposedByAgent} />}
      />
      <ProductView data={data} />
    </>
  );
}
