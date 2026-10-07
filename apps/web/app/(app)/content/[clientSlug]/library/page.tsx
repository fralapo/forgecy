import {
  assetCommercialUse,
  commercialUseFor,
  hasProductCatalog,
  listAssets,
  productSource,
  readAssetRights,
  type AssetRow,
  type CommercialUse,
} from "@forgecy/content";
import { assetSources, assetStatuses, can, providerIds } from "@forgecy/core";
import { Badge, Card, CardDescription, CardHeader, CardTitle, cn } from "@forgecy/ui";
import { ImageOff, PackageOpen } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getFormat } from "@/lib/i18n";
import { ActionButton } from "../../_components/action-button";
import {
  LibraryAltForm,
  LibraryDecision,
  LibraryRightsForm,
} from "../../_components/library-asset-controls";
import { LibraryUploadForm } from "../../_components/library-upload";
import { libraryPath } from "../../_lib/paths";
import { loadClient, thumbnailUrls } from "../../_lib/server";
import { importProductImageAction } from "./actions";

const statusVariant = { draft: "warning", approved: "success", rejected: "error" } as const;

interface Generation {
  provider?: string;
  model?: string;
  costMicroUsd?: number;
  prompt?: string;
  brief?: string;
  commercialUse?: CommercialUse;
}

const pick = <T extends string>(all: readonly T[], v: unknown): T | undefined =>
  typeof v === "string" && (all as readonly string[]).includes(v) ? (v as T) : undefined;

export default async function LibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ clientSlug }, sp] = await Promise.all([params, searchParams]);
  const { db, user, client } = await loadClient(clientSlug);
  const source = pick(assetSources, sp.source);
  const status = pick(assetStatuses, sp.status);
  const canDecide = can(user.actor, "approve", client.id);
  const canUpload = can(user.actor, "assets.upload", client.id);
  const t = await getTranslations("content.library");
  const tl = await getTranslations("content.labels");
  const format = await getFormat();
  const formatBytes = (n: number) =>
    n < 1024 * 1024
      ? t("sizeKb", { size: format.number(Math.max(1, Math.round(n / 1024))) })
      : t("sizeMb", { size: format.number(n / 1024 / 1024, { maximumFractionDigits: 1 }) });
  const formatCost = (microUsd: number) =>
    format.number(microUsd / 1_000_000, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 3,
    });
  const sourceLabel = (s: AssetRow["source"]) => tl(`assetSource.${s}`);
  const statusLabel = (s: AssetRow["status"]) => tl(`assetStatus.${s}`);

  const all = await listAssets(db, client.id, status ? { status: [status], limit: 500 } : {});
  const rows = source ? all.filter((a) => a.source === source) : all;
  const products =
    canUpload && hasProductCatalog() ? await productSource().listApproved(db, client.id) : [];
  const productImages = products.flatMap((p) =>
    p.images
      .map((img, i) => ({ product: p, img, i }))
      .filter(({ img }) => img.storageKey.startsWith(`clients/${client.id}/`)),
  );
  const urls = await thumbnailUrls(client.id, [
    ...rows.map((a) => a.storageKey),
    ...productImages.map((x) => x.img.storageKey),
  ]);
  const providers = new Set(
    rows.map((a) => pick(providerIds, (a.generation as Generation | null)?.provider)),
  );
  const commercial = new Map<string, CommercialUse>(
    await Promise.all(
      [...providers]
        .filter((p) => p !== undefined)
        .map(async (p) => [p, await commercialUseFor(db, p, client.id)] as const),
    ),
  );

  const base = libraryPath(client.slug);
  const href = (q: { source?: string | undefined; status?: string | undefined }) => {
    const qs = new URLSearchParams(
      Object.entries(q).filter((e): e is [string, string] => Boolean(e[1])),
    ).toString();
    return (qs ? `${base}?${qs}` : base) as Route;
  };
  const chip = (active: boolean) =>
    cn(
      "rounded-sm border px-3 py-1 text-body-sm",
      active ? "border-primary text-link" : "border-subtle text-fg",
    );

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h2 className="text-heading-md text-fg">{t("title")}</h2>
        <p className="max-w-3xl text-body-sm text-fg-muted">{t("intro")}</p>
      </section>

      {canUpload ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("uploadTitle")}</CardTitle>
          </CardHeader>
          <LibraryUploadForm slug={client.slug} />
        </Card>
      ) : null}

      {productImages.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("importTitle")}</CardTitle>
            <CardDescription>{t("importDescription")}</CardDescription>
          </CardHeader>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {productImages.map(({ product, img, i }) => (
              <li key={`${product.id}-${i}`} className="space-y-2">
                <Thumb
                  url={urls.get(img.storageKey)}
                  alt={img.alt || product.name}
                  unavailable={t("noPreview")}
                />
                <p className="truncate text-body-sm text-fg" title={product.name}>
                  {product.name}
                </p>
                <ActionButton
                  size="sm"
                  variant="secondary"
                  action={importProductImageAction.bind(null, {
                    slug: client.slug,
                    clientId: client.id,
                    productId: product.id,
                    image: i,
                  })}
                >
                  <PackageOpen aria-hidden />
                  {t("import")}
                </ActionButton>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <nav aria-label={t("filters.label")} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-label text-fg-muted">{t("filters.source")}</span>
          <Link href={href({ status })} className={chip(!source)}>
            {t("filters.all")}
          </Link>
          {assetSources.map((s) => (
            <Link key={s} href={href({ source: s, status })} className={chip(source === s)}>
              {sourceLabel(s)}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-label text-fg-muted">{t("filters.status")}</span>
          <Link href={href({ source })} className={chip(!status)}>
            {t("filters.all")}
          </Link>
          {assetStatuses.map((s) => (
            <Link key={s} href={href({ source, status: s })} className={chip(status === s)}>
              {statusLabel(s)}
            </Link>
          ))}
        </div>
      </nav>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-subtle p-6 text-body-sm text-fg-muted">
          {source || status ? t("emptyFiltered") : t("empty")}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((a) => {
            const gen = a.source === "ai" ? (a.generation as Generation | null) : null;
            const use = gen?.provider
              ? (commercial.get(gen.provider) ?? gen.commercialUse)
              : gen?.commercialUse;
            const rights = a.source === "upload" ? readAssetRights(a.rights) : null;
            const uploadUse = a.source === "upload" ? assetCommercialUse(a) : null;
            const ref = { slug: client.slug, clientId: client.id, id: a.id };
            return (
              <li key={a.id}>
                <Card className="h-full gap-3 p-4">
                  <Thumb url={urls.get(a.storageKey)} alt={a.alt} unavailable={t("noPreview")} />
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={statusVariant[a.status]}>{statusLabel(a.status)}</Badge>
                    <Badge variant={a.source === "ai" ? "highlight" : "neutral"}>
                      {sourceLabel(a.source)}
                    </Badge>
                    {gen && use !== "verified" ? (
                      <Badge variant={use === "rejected" ? "error" : "warning"}>
                        {use === "rejected" ? t("commercialRejected") : t("commercialPending")}
                      </Badge>
                    ) : null}
                    {uploadUse ? (
                      <Badge variant={rights ? "success" : "warning"}>
                        {rights ? t("rights.confirmedBadge") : t("rights.pendingBadge")}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-body-sm text-fg-muted">
                    {a.width && a.height
                      ? `${t("dimensions", { width: a.width, height: a.height })} · `
                      : ""}
                    {formatBytes(a.size)} · {format.date(a.createdAt, "dateTime")}
                  </p>
                  {gen ? (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body-sm">
                      <dt className="text-fg-muted">{t("model")}</dt>
                      <dd className="text-fg">
                        {[gen.provider, gen.model].filter(Boolean).join(" · ") || "—"}
                      </dd>
                      <dt className="text-fg-muted">{t("cost")}</dt>
                      <dd className="text-fg">
                        {typeof gen.costMicroUsd === "number" ? formatCost(gen.costMicroUsd) : "—"}
                      </dd>
                      <dt className="text-fg-muted">{t("prompt")}</dt>
                      <dd className="line-clamp-3 text-fg" title={gen.prompt}>
                        {gen.brief || gen.prompt || "—"}
                      </dd>
                    </dl>
                  ) : null}
                  {a.status === "rejected" && a.rejectedReason ? (
                    <p className="text-body-sm text-error">
                      {t("rejectedReason", { reason: a.rejectedReason })}
                    </p>
                  ) : null}
                  {rights ? (
                    <p className="text-body-sm text-fg-muted">
                      {t("rights.summary", {
                        basis: t(`rights.bases.${rights.basis}`),
                        date: format.date(new Date(rights.confirmedAt), "dateTime"),
                      })}
                      {rights.note ? ` · ${rights.note}` : ""}
                    </p>
                  ) : null}
                  {a.source === "upload" && canUpload ? (
                    <LibraryRightsForm
                      {...ref}
                      initial={rights ? { basis: rights.basis, note: rights.note } : null}
                    />
                  ) : null}
                  {canDecide ? <LibraryAltForm {...ref} alt={a.alt} /> : null}
                  {a.status === "draft" && canDecide ? <LibraryDecision {...ref} /> : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Thumb({
  url,
  alt,
  unavailable,
}: {
  url: string | undefined;
  alt: string;
  unavailable: string;
}) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className="aspect-square w-full rounded-md border border-subtle bg-app object-contain"
    />
  ) : (
    <div className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-subtle text-fg-muted">
      <ImageOff aria-hidden />
      <span className="sr-only">{unavailable}</span>
    </div>
  );
}
