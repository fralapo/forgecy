import { Card } from "@forgecy/ui";
import { benchmarkMetrics, type BenchmarkTable } from "@forgecy/social";
import { Trophy } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatDelta, formatMetric } from "../_lib/metrics";
import { socialPath } from "../_lib/server";
import { getFormat } from "@/lib/i18n";

/** Profiles side by side: the best value of each column is marked, with the gap from our client. */
export async function BenchmarkCard({ slug, table }: { slug: string; table: BenchmarkTable }) {
  const t = await getTranslations("social");
  const format = await getFormat();
  const hasSelf = table.rows.some((r) => r.role === "self");
  return (
    <Card className="mb-6">
      <div className="space-y-1">
        <h2 className="text-heading-sm text-fg">{t("benchmark.title")}</h2>
        <p className="text-body-sm text-fg-muted">{t("benchmark.description")}</p>
      </div>
      {table.basisWarning ? (
        <p
          role="status"
          className="rounded-md border border-warning-fill px-4 py-3 text-body-sm text-fg"
        >
          {t("benchmark.warning")}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-3xl border-collapse text-body-sm">
          <thead>
            <tr className="border-b border-subtle text-left text-fg-muted">
              <th scope="col" className="py-2 pr-4 font-medium">
                {t("benchmark.profile")}
              </th>
              {benchmarkMetrics.map((m) => (
                <th key={m} scope="col" className="px-2 py-2 text-right font-medium">
                  {t(`benchmark.metrics.${m}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.handle} className="border-b border-subtle last:border-b-0">
                <th scope="row" className="py-3 pr-4 text-left font-normal">
                  <Link
                    href={socialPath(slug, row.handle) as Route}
                    className="font-medium text-link"
                  >
                    @{row.handle}
                  </Link>
                  <span className="block text-fg-muted">{t(`roles.${row.role}`)}</span>
                </th>
                {benchmarkMetrics.map((m) => {
                  const value = row.values[m];
                  const delta = row.vsSelf[m];
                  const best = row.ranks[m] === 1 && table.rows.length > 1;
                  const d =
                    delta !== null && row.role !== "self" ? formatDelta(format, m, delta) : null;
                  return (
                    <td key={m} className="px-2 py-3 text-right align-top">
                      {value === null ? (
                        <span className="text-fg-muted">{t("unavailable")}</span>
                      ) : (
                        <span className={best ? "font-medium text-success" : "text-fg"}>
                          {best ? (
                            <>
                              <Trophy aria-hidden className="mr-1 inline size-4" />
                              <span className="sr-only">{t("benchmark.best")}</span>
                            </>
                          ) : null}
                          {formatMetric(format, m, value)}
                        </span>
                      )}
                      {d ? (
                        <span className="block text-fg-muted">
                          {d.points ? t("benchmark.points", { value: d.value }) : d.value}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-body-sm text-fg-muted">
        {hasSelf ? t("benchmark.vsUsNote") : t("benchmark.noSelf")}
      </p>
    </Card>
  );
}
