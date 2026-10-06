import {
  approvalBlockers,
  describeSource,
  fieldDef,
  formatValue,
  pendingSensitive,
  productDetail,
  type FieldKey,
  type FieldMetaMap,
  type SourceRef,
} from "@forgecy/catalog";
import { getDb } from "@forgecy/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ProductStatusBadge, Breadcrumb } from "../../_components/ui";
import { longDate } from "../../_lib/labels";
import { paths } from "../../_lib/paths";
import { catalogPage, getStorage, imageUrl } from "../../_lib/server";
import { NotAClient } from "../not-a-client";
import { ProductView, type ProductViewData } from "./product-view";

export const metadata = { title: "Prodotto" };

const historyLabels: Record<string, string> = {
  "product.create": "Creato",
  "product.create_from_import": "Creato dall'import",
  "product.update": "Modificato",
  "product.approve": "Approvato",
  "product.reject": "Rifiutato",
  "product.archive": "Archiviato",
  "product.restore": "Ripristinato",
  "product.to_draft": "Riportato in bozza",
  "product.duplicate": "Duplicato",
  "product.sensitive_accept": "Campo sensibile accettato",
  "product.field_proposal_accepted": "Proposta di campo accettata",
  "product.field_proposal_rejected": "Proposta di campo rifiutata",
  "product.image_add": "Immagine aggiunta",
  "product.image_primary": "Immagine principale cambiata",
  "product.image_unlink": "Immagine scollegata",
  "product.image_approve": "Immagine approvata",
  "product.image_alt": "Testo alternativo modificato",
};

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
          source: describeSource(m.source),
          sensitive: m.sensitive ?? [],
          accepted: !!m.acceptedBy,
          page: m.source.page ?? null,
          fileId: m.source.fileId ?? null,
        },
      ]),
    ),
    blockers: approvalBlockers(fields, meta),
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
      label: fieldDef(pr.field as FieldKey)?.label ?? pr.field,
      current: formatValue(pr.field as FieldKey, pr.currentValue),
      proposed: formatValue(pr.field as FieldKey, pr.proposedValue),
      proposedRaw: pr.proposedValue,
      source: (pr.meta as { source?: SourceRef } | null)?.source
        ? describeSource((pr.meta as { source: SourceRef }).source)
        : "Import",
      status: pr.status,
      when: longDate(pr.createdAt),
      decidedBy: decidedByName,
    })),
    history: detail.history.map(({ e, userName }) => ({
      id: String(e.id),
      label: historyLabels[e.action] ?? e.action,
      who: userName ?? (e.actor.startsWith("agent") ? "Brand Analyst" : "Sistema"),
      when: longDate(e.at),
      field:
        typeof e.meta?.field === "string"
          ? (fieldDef(e.meta.field as FieldKey)?.label ?? null)
          : null,
      note: typeof e.meta?.note === "string" ? e.meta.note : null,
    })),
    sources: [
      ...(detail.sourceImport
        ? [
            {
              label: `Import del ${longDate(detail.sourceImport.createdAt)}`,
              href: paths.review(client.slug, detail.sourceImport.id),
              external: false,
            },
          ]
        : []),
      ...(await Promise.all(
        detail.pdfSources
          .filter((f) => f.storageKey)
          .map(async (f) => ({
            label: `PDF · ${f.name}`,
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
          { label: "Clienti", href: "/clienti" },
          { label: client.name, href: "/prodotti" },
          { label: "Prodotti", href: paths.catalog(client.slug) },
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
