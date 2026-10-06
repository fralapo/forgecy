import { channelsWithData, getComparisonView } from "@forgecy/audit";
import { comparisonChannels } from "@forgecy/core";
import { Card, CardDescription, CardHeader, CardTitle } from "@forgecy/ui";
import { Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requestComparisonAction } from "../../actions";
import { ActionButton } from "../../_components/action-button";
import { ComparisonRow } from "../../_components/comparison-row";
import { sectionContext } from "../../_lib/findings";

export async function generateMetadata() {
  const t = await getTranslations("audit.comparison");
  return { title: t("metaTitle") };
}

export default async function ComparisonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { db, audit, readOnly, aiAllowed } = await sectionContext(slug);
  const [rows, withData] = await Promise.all([
    getComparisonView(db, audit.id),
    channelsWithData(db, audit.id),
  ]);
  const ready = comparisonChannels.filter((c) => withData.includes(c));
  const missing = comparisonChannels.filter((c) => !withData.includes(c));
  const t = await getTranslations("audit");

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader>
          <CardTitle>{t("comparison.title")}</CardTitle>
          <CardDescription>{t("comparison.description")}</CardDescription>
        </CardHeader>
        <p className="text-body-sm">
          {t("comparison.withData", {
            channels: ready.length
              ? ready.map((c) => t(`channel.${c}`)).join(", ")
              : t("comparison.none"),
          })}
          {missing.length ? (
            <span className="text-fg-muted">
              {t("comparison.withoutData", {
                channels: missing.map((c) => t(`channel.${c}`)).join(", "),
              })}
            </span>
          ) : null}
        </p>
        {!readOnly && aiAllowed ? (
          ready.length >= 2 ? (
            <div>
              <ActionButton
                action={requestComparisonAction.bind(null, audit.id, undefined)}
                icon={<Sparkles aria-hidden />}
                variant="primary"
              >
                {rows.length ? t("comparison.update") : t("comparison.generate")}
              </ActionButton>
            </div>
          ) : (
            <p className="text-body-sm text-fg-muted">{t("comparison.needTwoChannels")}</p>
          )
        ) : null}
        {!aiAllowed ? <p className="text-body-sm text-fg-muted">{t("comparison.noAi")}</p> : null}
      </Card>
      {rows.length ? (
        <div className="flex flex-col gap-4">
          {rows.map((r) =>
            r.comparison ? (
              <ComparisonRow
                key={r.id}
                readOnly={readOnly}
                row={{
                  id: r.id,
                  title: r.title,
                  rev: r.rev,
                  status: r.status,
                  outcome: r.comparison.outcome,
                  proposedOutcome: r.comparison.proposedOutcome ?? r.comparison.outcome,
                  rationale: r.comparison.rationale,
                  ...(r.comparison.outcomeNote ? { outcomeNote: r.comparison.outcomeNote } : {}),
                  cells: r.comparison.cells,
                }}
              />
            ) : null,
          )}
        </div>
      ) : null}
    </div>
  );
}
