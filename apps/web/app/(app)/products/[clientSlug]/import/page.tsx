import {
  clientBudget,
  estimateImportCostUsd,
  IMPORT_LIMITS,
  importFiles,
  importOptions,
  loadImport,
  mappingTargetLabels,
  openDraftImport,
  plannedAiSteps,
  routesFor,
  type FileMeta,
  type ImportFileRow,
  type MappingProposalData,
  type MappingTarget,
} from "@forgecy/catalog";
import type { MessageRef } from "@forgecy/core";
import { eq, getDb, jobs } from "@forgecy/db";
import { Button, Card } from "@forgecy/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { getFormat, refText } from "@/lib/i18n";
import { AutoRefresh } from "../../_components/client";
import { Banner, Breadcrumb, ImportStatusBadge } from "../../_components/ui";
import {
  formatBytes,
  formatUsd,
  stepLabel,
  validFileText,
  type ProductsT,
} from "../../_lib/labels";
import { paths } from "../../_lib/paths";
import { catalogPage } from "../../_lib/server";
import { NotAClient } from "../not-a-client";
import { FileStep, type FileRowView } from "./file-step";
import { ImportControls } from "./import-controls";
import { MappingStep, type SheetView } from "./mapping-step";

export async function generateMetadata() {
  const t = await getTranslations("products");
  return { title: t("import.title") };
}

const steps = ["file", "mapping", "analysis", "review"] as const;
const MB = 1024 * 1024;

/** The file's validation text: what was read, or why it is not valid. */
async function fileStatus(t: ProductsT, f: ImportFileRow): Promise<string> {
  if (f.valid) return validFileText(t, f);
  return refText((f.meta as FileMeta | null)?.messageRef, f.message ?? t("files.invalid"));
}

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<{ importId?: string }>;
}) {
  const { clientSlug } = await params;
  const { importId } = await searchParams;
  const { client, acting, ai } = await catalogPage(clientSlug);
  if (client.status !== "active") return <NotAClient name={client.name} />;
  const t = await getTranslations("products");
  const format = await getFormat();
  const db = getDb();
  if (!importId || !/^[0-9a-f-]{36}$/i.test(importId)) {
    const draft = await openDraftImport(db, acting, client.id);
    redirect(paths.importOpen(client.slug, draft.id));
  }
  const imp = await loadImport(db, client.id, importId).catch(() => notFound());
  const files = await importFiles(db, imp.id);
  const options = importOptions(imp);
  const planned = plannedAiSteps(files, options, ai.available);
  const [budget, job] = await Promise.all([
    clientBudget(db, client.id),
    imp.jobId ? db.query.jobs.findFirst({ where: eq(jobs.id, imp.jobId) }) : undefined,
  ]);
  const cost = estimateImportCostUsd(ai, planned);
  const summary = (imp.summary ?? {}) as {
    files?: number;
    rows?: number;
    pages?: number;
    images?: number;
    found?: number;
    imagesMatched?: number;
    imagesUnassigned?: number;
    costMicroUsd?: number;
    warnings?: Array<{ code: string; message: string; ref?: MessageRef }>;
  };

  const top = files.filter((f) => !f.parentId);
  const fileRows: FileRowView[] = await Promise.all(
    top.map(async (f) => ({
      id: f.id,
      name: f.path,
      kind: f.kind,
      kindLabel: t(`kinds.${f.kind}`),
      size: formatBytes(format, f.size),
      valid: f.valid,
      message: await fileStatus(t, f),
      errorCode: f.errorCode,
      route: f.route,
      routes: f.valid
        ? routesFor(f.kind, ai.available && !(f.meta as FileMeta).textless).map((r) => ({
            value: r,
            label: t(`routes.${r}`),
          }))
        : [],
      children: await Promise.all(
        files
          .filter((c) => c.parentId === f.id)
          .map(async (c) => ({
            id: c.id,
            name: c.path,
            kindLabel: t(`kinds.${c.kind}`),
            valid: c.valid,
            message: await fileStatus(t, c),
          })),
      ),
    })),
  );

  const sheets: SheetView[] = files
    .filter((f) => f.kind === "sheet" && f.valid && f.route === "map" && !f.mapping)
    .map((f) => {
      const meta = f.meta as FileMeta;
      const proposal = f.mappingProposal as unknown as MappingProposalData | null;
      return {
        id: f.id,
        name: f.path,
        headers: meta.headers ?? [],
        sample: (meta.sample ?? []).slice(0, 5),
        columns: proposal?.columns ?? (meta.headers ?? []).map(() => "ignore"),
        confidence: proposal?.confidence ?? [],
        preset: proposal?.preset ?? null,
        savedName: proposal?.savedName ?? null,
        listSeparator: proposal?.listSeparator ?? null,
      };
    });
  const targets = (Object.keys(mappingTargetLabels) as MappingTarget[]).map((value) => ({
    value,
    label: t(`mappingTargets.${value}`),
  }));

  const stepIndex =
    imp.status === "uploading"
      ? 0
      : imp.status === "needs_mapping"
        ? 1
        : imp.status === "analyzing" || imp.status === "failed"
          ? 2
          : 3;
  const hasSheets = files.some((f) => f.kind === "sheet");
  const budgetPercent = budget.percent;
  const blockedByBudget = planned.usesAi && budgetPercent !== null && budgetPercent >= 100;
  const policy = t(`ai.policy.${client.aiPolicy}`);
  const aiReason = ai.available || !ai.reason ? null : await refText(ai.reasonRef, ai.reason);
  const warnings = await Promise.all(
    (summary.warnings ?? []).map(async (w) => ({
      code: w.code,
      message: await refText(w.ref, w.message),
    })),
  );
  const failCode = imp.errorCode ?? "IMPORT-FAILED";
  // The job keeps a reference to the error; the import row keeps the English text.
  const failure =
    imp.status === "failed"
      ? job?.errorRef
        ? [
            imp.failedStep
              ? t("import.failedAt", { step: stepLabel(t, imp.failedStep) })
              : t("import.failed"),
            await refText(job.errorRef, job.error ?? ""),
            `(${failCode})`,
          ].join(" ")
        : [imp.error ?? t("import.failed"), `(${failCode})`].join(" ")
      : null;

  return (
    <>
      {imp.status === "analyzing" ? <AutoRefresh /> : null}
      <Breadcrumb
        items={[
          { label: t("breadcrumb.clients"), href: "/clients" },
          { label: client.name, href: "/products" },
          { label: t("breadcrumb.products"), href: paths.catalog(client.slug) },
          { label: t("breadcrumb.import") },
        ]}
      />
      <PageHeader
        title={t("import.title")}
        description={t("import.description", { date: format.date(imp.createdAt), policy })}
        actions={<ImportStatusBadge status={imp.status} />}
      />
      <ol className="mb-6 flex flex-wrap gap-2" aria-label={t("import.steps.label")}>
        {steps.map((s, i) =>
          s === "mapping" && !hasSheets ? null : (
            <li
              key={s}
              aria-current={i === stepIndex ? "step" : undefined}
              className={
                i === stepIndex
                  ? "rounded-md border border-primary px-3 py-1 text-body-sm text-fg"
                  : "rounded-md border border-subtle px-3 py-1 text-body-sm text-fg-muted"
              }
            >
              {t("import.steps.item", { number: i + 1, step: t(`import.steps.${s}`) })}
            </li>
          ),
        )}
      </ol>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          {imp.status === "uploading" ? (
            <FileStep
              clientId={client.id}
              clientSlug={client.slug}
              importId={imp.id}
              files={fileRows}
              limitsText={t("files.limits", {
                rows: IMPORT_LIMITS.sheetRows,
                archiveMb: IMPORT_LIMITS.archiveBytes / MB,
                archiveFiles: IMPORT_LIMITS.archiveFiles,
                imageMb: IMPORT_LIMITS.imageBytes / MB,
                pdfMb: IMPORT_LIMITS.pdfBytes / MB,
              })}
              aiReason={aiReason}
              options={{
                language: options.language,
                matchImages: options.matchImages,
                official: options.official,
              }}
            />
          ) : null}

          {imp.status === "needs_mapping" ? (
            <MappingStep
              clientId={client.id}
              importId={imp.id}
              clientName={client.name}
              sheets={sheets}
              targets={targets}
            />
          ) : null}

          {imp.status === "analyzing" ? (
            <Card>
              <h2 className="text-heading-sm">{t("import.analysis")}</h2>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={job?.progress ?? 0}
                aria-label={t("import.progressLabel")}
                className="h-2 w-full overflow-hidden rounded-sm bg-subtle"
              >
                <div className="h-full bg-primary" style={{ width: `${job?.progress ?? 0}%` }} />
              </div>
              <p aria-live="polite" className="text-body-sm text-fg-muted">
                {t(job?.status === "retrying" ? "import.progressRetrying" : "import.progress", {
                  percent: job?.progress ?? 0,
                  files: top.length,
                })}
              </p>
              <p className="text-body-md text-fg-muted">{t("import.leavePage")}</p>
            </Card>
          ) : null}

          {failure ? <Banner tone="error">{failure}</Banner> : null}

          {warnings.length ? (
            <div className="space-y-2">
              {warnings.map((w, i) => (
                <Banner key={i} tone="warning">
                  {t("import.warning", { message: w.message, code: w.code })}
                </Banner>
              ))}
            </div>
          ) : null}

          {imp.status === "ready_for_review" ||
          imp.status === "completed" ||
          imp.status === "partial" ? (
            <Card>
              <h2 className="text-heading-sm">{t("import.complete")}</h2>
              <p className="text-body-md text-fg">
                {t("import.found", {
                  products: summary.found ?? 0,
                  images: summary.imagesMatched ?? 0,
                  unassigned: summary.imagesUnassigned ?? 0,
                })}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <Link href={paths.review(client.slug, imp.id)}>{t("import.reviewProducts")}</Link>
                </Button>
                <Button asChild variant="secondary">
                  <a href={paths.discards(client.slug, imp.id)}>{t("downloadDiscards")}</a>
                </Button>
              </div>
            </Card>
          ) : null}

          {imp.status === "cancelled" ? (
            <Banner>
              {t("import.cancelled")}{" "}
              <Link href={paths.importNew(client.slug)} className="text-link hover:underline">
                {t("import.newImport")}
              </Link>
            </Banner>
          ) : null}

          <ImportControls
            clientId={client.id}
            clientName={client.name}
            status={imp.status}
            importId={imp.id}
            catalogHref={paths.catalog(client.slug)}
            usesAi={planned.usesAi}
            restricted={client.aiPolicy === "external_restricted"}
            costText={planned.usesAi ? formatUsd(format, cost) : null}
            budgetPercent={budgetPercent}
            blockedByBudget={blockedByBudget}
            hasValidFiles={files.some((f) => f.valid && f.route !== "ignore")}
          />
        </div>

        <aside aria-label={t("import.summary.label")}>
          <Card className="gap-3">
            <h2 className="text-heading-sm">{t("import.summary.title")}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-body-sm">
              <dt className="text-fg-muted">{t("import.summary.files")}</dt>
              <dd>{format.number(top.length)}</dd>
              {summary.rows ? (
                <>
                  <dt className="text-fg-muted">{t("import.summary.rows")}</dt>
                  <dd>{format.number(summary.rows)}</dd>
                </>
              ) : null}
              {planned.pdfPages || summary.pages ? (
                <>
                  <dt className="text-fg-muted">{t("import.summary.pdfPages")}</dt>
                  <dd>{format.number(summary.pages ?? planned.pdfPages)}</dd>
                </>
              ) : null}
              <dt className="text-fg-muted">{t("import.summary.aiPolicy")}</dt>
              <dd>{policy}</dd>
              {ai.available && ai.provider ? (
                <>
                  <dt className="text-fg-muted">{t("import.summary.model")}</dt>
                  <dd>
                    {ai.provider} · {ai.model}
                  </dd>
                </>
              ) : null}
              {planned.usesAi && imp.status === "uploading" ? (
                <>
                  <dt className="text-fg-muted">{t("import.summary.estimatedCost")}</dt>
                  <dd>{formatUsd(format, cost)}</dd>
                </>
              ) : null}
              {summary.costMicroUsd !== undefined ? (
                <>
                  <dt className="text-fg-muted">{t("import.summary.actualCost")}</dt>
                  <dd>{formatUsd(format, summary.costMicroUsd / 1_000_000)}</dd>
                </>
              ) : null}
              <dt className="text-fg-muted">{t("import.summary.budget")}</dt>
              <dd>
                {budgetPercent === null
                  ? t("import.summary.noBudget")
                  : t("import.summary.budgetUsed", { percent: budgetPercent })}
              </dd>
              {imp.startedAt ? (
                <>
                  <dt className="text-fg-muted">{t("import.summary.started")}</dt>
                  <dd>{format.date(imp.startedAt, "dateTime")}</dd>
                </>
              ) : null}
            </dl>
            {aiReason ? <p className="text-body-sm text-fg-muted">{aiReason}</p> : null}
          </Card>
        </aside>
      </div>
    </>
  );
}
