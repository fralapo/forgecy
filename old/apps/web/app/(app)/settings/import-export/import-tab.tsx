import { getClientImport, listClientImports } from "@forgecy/client-transfer";
import {
  CLIENT_PACKAGE_MAX_BYTES,
  clientTransferAreas,
  type Actor,
  type ClientImportStatus,
} from "@forgecy/core";
import { getDb, sql } from "@forgecy/db";
import { Badge, Card } from "@forgecy/ui";
import { CircleCheck, TriangleAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { z } from "zod";
import { getFormat } from "@/lib/i18n";
import { RefreshWhileRunning } from "../backup/forms";
import { ImportWizard } from "./import-wizard";
import { Stepper } from "./stepper";
import { UploadForm } from "./upload-form";

const statusVariant = {
  verifying: "info",
  invalid: "error",
  ready: "warning",
  importing: "info",
  done: "success",
  failed: "error",
  cancelled: "neutral",
} as const satisfies Record<ClientImportStatus, string>;

const TAB = "/settings/import-export?tab=import";
/** Error codes shown next to the message (spec page 68). */
const INVALID_CODE = "IMPORT-INVALID";
const FAILED_CODE = "IMPORT-FAILED";

async function existingCounts(clientId: string) {
  const res = await getDb().execute<{ versions: number; carousels: number; audits: number }>(sql`
    select
      (select count(*)::int from brand_identity_versions v
         join brand_identities b on b.id = v.brand_identity_id where b.client_id = ${clientId}) as versions,
      (select count(*)::int from contents where client_id = ${clientId}) as carousels,
      (select count(*)::int from audits where client_id = ${clientId}) as audits`);
  return res.rows[0] ?? { versions: 0, carousels: 0, audits: 0 };
}

/** Tab “Import client” (spec page 68): File, Verify, Conflicts, Confirm, then the outcome. */
export async function ImportTab({ actor, importId }: { actor: Actor; importId?: string }) {
  const t = await getTranslations("clientTransfer");
  const format = await getFormat();
  const db = getDb();
  const id = z.uuid().safeParse(importId);
  const row = id.success ? await getClientImport(db, actor, id.data) : null;
  const recent = await listClientImports(db, actor);
  const size = (bytes: number) =>
    bytes < 1024 * 1024
      ? format.number(Math.max(1, Math.round(bytes / 1024)), { style: "unit", unit: "kilobyte" })
      : format.number(bytes / 1024 / 1024, {
          style: "unit",
          unit: "megabyte",
          maximumFractionDigits: 1,
        });
  const maxLabel = format.number(CLIENT_PACKAGE_MAX_BYTES / 1024 ** 3, {
    style: "unit",
    unit: "gigabyte",
  });
  const steps = [
    t("import.steps.file"),
    t("import.steps.verify"),
    t("import.steps.conflicts"),
    t("import.steps.confirm"),
  ];
  const stepper = (current: number) => (
    <Stepper
      label={t("import.stepsLabel")}
      steps={steps}
      current={current}
      states={{
        done: t("import.stepState.done"),
        current: t("import.stepState.current"),
        todo: t("import.stepState.todo"),
      }}
    />
  );
  const again = (label: string) => (
    <Link href={TAB as Route} className="text-body-sm text-link">
      {label}
    </Link>
  );
  const busy =
    row?.status === "verifying" ||
    row?.status === "importing" ||
    recent.some((r) => r.import.status === "verifying" || r.import.status === "importing");
  const clientConflict = row?.conflicts.find((c) => c.kind === "client");
  const doneSlug =
    row?.status === "done" && row.clientId
      ? (
          await db.execute<{ slug: string }>(
            sql`select slug from clients where id = ${row.clientId}`,
          )
        ).rows[0]?.slug
      : undefined;

  let main: ReactNode;
  if (!row) {
    main = (
      <>
        {stepper(0)}
        <UploadForm maxLabel={maxLabel} />
      </>
    );
  } else if (row.status === "verifying") {
    main = (
      <>
        {stepper(1)}
        <h3 className="text-heading-sm text-fg">{t("import.verifying.title")}</h3>
        <p className="mt-2 text-body-sm text-fg-muted">{t("import.verifying.body")}</p>
      </>
    );
  } else if (row.status === "invalid") {
    main = (
      <>
        {stepper(1)}
        <div role="alert" className="grid gap-2">
          <h3 className="flex items-center gap-2 text-heading-sm text-fg">
            <TriangleAlert aria-hidden className="size-5 text-error" />
            {t("import.invalid.title")}
          </h3>
          {row.problems.map((p) => (
            <p key={p} className="text-body-sm text-fg">
              {t(`import.problems.${p}`)}{" "}
              <span className="font-mono text-fg-muted">{INVALID_CODE}</span>
            </p>
          ))}
        </div>
        <div className="mt-4">{again(t("import.invalid.again"))}</div>
      </>
    );
  } else if (row.status === "ready" && row.report) {
    main = (
      <ImportWizard
        importId={row.id}
        pkgClient={row.report.client}
        conflicts={row.conflicts}
        resolved={row.resolved}
        replaceCounts={clientConflict ? await existingCounts(clientConflict.existingId) : null}
      />
    );
  } else if (row.status === "importing" || row.status === "ready") {
    main = (
      <>
        {stepper(3)}
        <h3 className="text-heading-sm text-fg">
          {t("import.importing.title", { name: row.report?.client.name ?? row.fileName })}
        </h3>
        <p className="mt-2 text-body-sm text-fg-muted">{t("import.importing.body")}</p>
      </>
    );
  } else if (row.status === "done") {
    main = (
      <div className="grid gap-3">
        <h3 className="flex items-center gap-2 text-heading-sm text-fg">
          <CircleCheck aria-hidden className="size-5 text-success" />
          {t("import.done.title", { name: row.report?.client.name ?? row.fileName })}
        </h3>
        <ul className="grid gap-1 text-body-sm text-fg">
          {clientTransferAreas
            .filter((a) => row.result?.[a])
            .map((a) => (
              <li key={a}>
                {t(`export.areas.${a}`)}: {t("summary.rows", { count: row.result?.[a] ?? 0 })}
              </li>
            ))}
        </ul>
        {row.backupName ? (
          <p className="text-body-sm text-fg-muted">
            {t("import.done.backup", { name: row.backupName })}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-4">
          {doneSlug ? (
            <Link href={`/clients/${doneSlug}` as Route} className="text-body-sm text-link">
              {t("import.done.open")}
            </Link>
          ) : null}
          {again(t("import.done.again"))}
        </div>
      </div>
    );
  } else if (row.status === "failed") {
    main = (
      <div className="grid gap-3">
        <div role="alert" className="grid gap-2">
          <h3 className="flex items-center gap-2 text-heading-sm text-fg">
            <TriangleAlert aria-hidden className="size-5 text-error" />
            {t("import.failed.title")}
          </h3>
          <p className="text-body-sm text-fg">
            {t("errors.importFailed")}{" "}
            <span className="font-mono text-fg-muted">{FAILED_CODE}</span>
          </p>
        </div>
        {again(t("import.failed.again"))}
      </div>
    );
  } else {
    main = (
      <div className="grid gap-3">
        <h3 className="text-heading-sm text-fg">{t("import.cancelledState.title")}</h3>
        {again(t("import.cancelledState.again"))}
      </div>
    );
  }

  const report = row?.report;
  return (
    <>
      <RefreshWhileRunning active={busy} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="p-6">{main}</Card>
        <Card className="p-6">
          <h3 className="text-heading-sm text-fg">{t("import.report.title")}</h3>
          {report ? (
            <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-body-sm">
              <dt className="text-fg-muted">{t("import.report.client")}</dt>
              <dd className="text-right text-fg">{report.client.name}</dd>
              <dt className="text-fg-muted">{t("import.report.exportedAt")}</dt>
              <dd className="text-right text-fg">
                {format.date(new Date(report.exportedAt), "dateTime")}
              </dd>
              <dt className="text-fg-muted">{t("import.report.size")}</dt>
              <dd className="text-right text-fg">{size(report.bytes)}</dd>
              {clientTransferAreas
                .filter((a) => report.areas.includes(a) && a !== "activity")
                .map((a) => (
                  <div key={a} className="contents">
                    <dt className="text-fg-muted">{t(`export.areas.${a}`)}</dt>
                    <dd className="text-right text-fg">
                      {t("summary.rows", { count: report.counts[a] ?? 0 })}
                    </dd>
                  </div>
                ))}
              <dt className="text-fg-muted">{t("import.report.files")}</dt>
              <dd className="text-right text-fg">{format.number(report.counts.files ?? 0)}</dd>
            </dl>
          ) : (
            <p className="mt-4 text-body-sm text-fg-muted">
              {t("import.file.hint", { size: maxLabel })}
            </p>
          )}
        </Card>
      </div>

      <h2 className="mt-8 mb-4 text-heading-sm text-fg">{t("import.recent.title")}</h2>
      {recent.length === 0 ? (
        <Card className="p-6">
          <p className="text-body-md text-fg-muted">{t("import.recent.empty")}</p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-subtle bg-surface">
          <table className="w-full text-left text-body-sm">
            <thead className="border-b border-subtle text-label text-fg-muted">
              <tr>
                {(["date", "file", "client", "statusColumn", "createdBy"] as const).map((c) => (
                  <th key={c} scope="col" className="px-4 py-3 font-medium">
                    {t(`import.recent.${c}`)}
                  </th>
                ))}
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">{t("import.recent.open")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {recent.map(({ import: r, createdByName }) => (
                <tr key={r.id} className="border-b border-subtle align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-fg">
                    {format.date(r.createdAt, "dateTime")}
                  </td>
                  <td className="px-4 py-3 text-fg">{r.fileName}</td>
                  <td className="px-4 py-3 text-fg">{r.report?.client.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant[r.status]}>
                      {t(`import.status.${r.status}`)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">
                    {createdByName ?? t("recent.unknown")}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`${TAB}&importId=${r.id}` as Route}
                      aria-current={r.id === row?.id ? "page" : undefined}
                      className="text-link"
                    >
                      {t("import.recent.open")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
