import {
  clientBudget,
  estimateImportCostUsd,
  IMPORT_LIMITS_TEXT,
  importFiles,
  importOptions,
  kindLabels,
  loadImport,
  mappingTargetLabels,
  openDraftImport,
  plannedAiSteps,
  routeLabels,
  routesFor,
  type FileMeta,
  type MappingProposalData,
} from "@forgecy/catalog";
import { eq, getDb, jobs } from "@forgecy/db";
import { Button, Card } from "@forgecy/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { AutoRefresh } from "../../_components/client";
import { Banner, Breadcrumb, ImportStatusBadge } from "../../_components/ui";
import { formatBytes, formatUsd, importTitle, longDate, plural } from "../../_lib/labels";
import { paths } from "../../_lib/paths";
import { catalogPage } from "../../_lib/server";
import { NotAClient } from "../not-a-client";
import { FileStep, type FileRowView } from "./file-step";
import { ImportControls } from "./import-controls";
import { MappingStep, type SheetView } from "./mapping-step";

export const metadata = { title: "Importa prodotti" };

const policyText = {
  external_allowed: "provider esterni",
  external_restricted: "provider esterni con conferma",
  local_only: "solo modello locale",
  no_ai: "disattivata",
} as const;

const steps = ["File", "Mappatura", "Analisi", "Revisione"] as const;

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
    warnings?: Array<{ code: string; message: string }>;
  };

  const top = files.filter((f) => !f.parentId);
  const fileRows: FileRowView[] = top.map((f) => ({
    id: f.id,
    name: f.path,
    kind: f.kind,
    kindLabel: kindLabels[f.kind],
    size: formatBytes(f.size),
    valid: f.valid,
    message: f.message,
    errorCode: f.errorCode,
    route: f.route,
    routes: f.valid
      ? routesFor(f.kind, ai.available && !(f.meta as FileMeta).textless).map((r) => ({
          value: r,
          label: routeLabels[r],
        }))
      : [],
    children: files
      .filter((c) => c.parentId === f.id)
      .map((c) => ({
        id: c.id,
        name: c.path,
        kindLabel: kindLabels[c.kind],
        valid: c.valid,
        message: c.message,
      })),
  }));

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
  const targets = Object.entries(mappingTargetLabels).map(([value, label]) => ({ value, label }));

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

  return (
    <>
      {imp.status === "analyzing" ? <AutoRefresh /> : null}
      <Breadcrumb
        items={[
          { label: "Clienti", href: "/clients" },
          { label: client.name, href: "/products" },
          { label: "Prodotti", href: paths.catalog(client.slug) },
          { label: "Importa" },
        ]}
      />
      <PageHeader
        title="Importa prodotti"
        description={`${importTitle(imp.createdAt)} · AI: ${policyText[client.aiPolicy]}`}
        actions={<ImportStatusBadge status={imp.status} />}
      />
      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Passi dell'import">
        {steps.map((s, i) =>
          s === "Mappatura" && !hasSheets ? null : (
            <li
              key={s}
              aria-current={i === stepIndex ? "step" : undefined}
              className={
                i === stepIndex
                  ? "rounded-md border border-primary px-3 py-1 text-body-sm text-fg"
                  : "rounded-md border border-subtle px-3 py-1 text-body-sm text-fg-muted"
              }
            >
              {i + 1} {s}
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
              limitsText={IMPORT_LIMITS_TEXT}
              aiReason={ai.available ? null : (ai.reason ?? null)}
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
              <h2 className="text-heading-sm">Analisi</h2>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={job?.progress ?? 0}
                aria-label="Avanzamento dell'analisi"
                className="h-2 w-full overflow-hidden rounded-sm bg-subtle"
              >
                <div className="h-full bg-primary" style={{ width: `${job?.progress ?? 0}%` }} />
              </div>
              <p aria-live="polite" className="text-body-sm text-fg-muted">
                {job?.status === "retrying" ? "Nuovo tentativo in corso · " : ""}
                {job?.progress ?? 0}% · {plural(top.length, "file", "file")}
              </p>
              <p className="text-body-md text-fg-muted">
                Puoi lasciare la pagina: i prodotti saranno pronti da rivedere nel catalogo.
              </p>
            </Card>
          ) : null}

          {imp.status === "failed" ? (
            <Banner tone="error">
              Import non riuscito{imp.failedStep ? ` al passo «${imp.failedStep}»` : ""}.{" "}
              {imp.error ?? ""} ({imp.errorCode ?? "IMPORT-FAILED"})
            </Banner>
          ) : null}

          {summary.warnings?.length ? (
            <div className="space-y-2">
              {summary.warnings.map((w, i) => (
                <Banner key={i} tone="warning">
                  {w.message} ({w.code})
                </Banner>
              ))}
            </div>
          ) : null}

          {imp.status === "ready_for_review" ||
          imp.status === "completed" ||
          imp.status === "partial" ? (
            <Card>
              <h2 className="text-heading-sm">Analisi completata</h2>
              <p className="text-body-md text-fg">
                Trovati {plural(summary.found ?? 0, "prodotto", "prodotti")} ·{" "}
                {plural(summary.imagesMatched ?? 0, "immagine abbinata", "immagini abbinate")} ·{" "}
                {summary.imagesUnassigned ?? 0} da assegnare
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <Link href={paths.review(client.slug, imp.id)}>Rivedi prodotti</Link>
                </Button>
                <Button asChild variant="secondary">
                  <a href={paths.discards(client.slug, imp.id)}>Scarica rapporto degli scarti</a>
                </Button>
              </div>
            </Card>
          ) : null}

          {imp.status === "cancelled" ? (
            <Banner>
              Import annullato: nessun prodotto è stato creato.{" "}
              <Link href={paths.importNew(client.slug)} className="text-link hover:underline">
                Nuovo import
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
            costText={planned.usesAi ? formatUsd(cost) : null}
            budgetPercent={budgetPercent}
            blockedByBudget={blockedByBudget}
            hasValidFiles={files.some((f) => f.valid && f.route !== "ignore")}
          />
        </div>

        <aside aria-label="Riepilogo import">
          <Card className="gap-3">
            <h2 className="text-heading-sm">Riepilogo import</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-body-sm">
              <dt className="text-fg-muted">File</dt>
              <dd>{top.length}</dd>
              {summary.rows ? (
                <>
                  <dt className="text-fg-muted">Righe</dt>
                  <dd>{summary.rows.toLocaleString("it-IT")}</dd>
                </>
              ) : null}
              {planned.pdfPages || summary.pages ? (
                <>
                  <dt className="text-fg-muted">Pagine PDF</dt>
                  <dd>{(summary.pages ?? planned.pdfPages).toLocaleString("it-IT")}</dd>
                </>
              ) : null}
              <dt className="text-fg-muted">Policy AI</dt>
              <dd>{policyText[client.aiPolicy]}</dd>
              {ai.available && ai.provider ? (
                <>
                  <dt className="text-fg-muted">Modello</dt>
                  <dd>
                    {ai.provider} · {ai.model}
                  </dd>
                </>
              ) : null}
              {planned.usesAi && imp.status === "uploading" ? (
                <>
                  <dt className="text-fg-muted">Costo stimato</dt>
                  <dd>{formatUsd(cost)}</dd>
                </>
              ) : null}
              {summary.costMicroUsd !== undefined ? (
                <>
                  <dt className="text-fg-muted">Costo effettivo</dt>
                  <dd>{formatUsd(summary.costMicroUsd / 1_000_000)}</dd>
                </>
              ) : null}
              <dt className="text-fg-muted">Budget</dt>
              <dd>
                {budgetPercent === null ? "Nessun budget impostato" : `${budgetPercent}% usato`}
              </dd>
              {imp.startedAt ? (
                <>
                  <dt className="text-fg-muted">Avviato</dt>
                  <dd>{longDate(imp.startedAt)}</dd>
                </>
              ) : null}
            </dl>
            {!ai.available && ai.reason ? (
              <p className="text-body-sm text-fg-muted">{ai.reason}</p>
            ) : null}
          </Card>
        </aside>
      </div>
    </>
  );
}
