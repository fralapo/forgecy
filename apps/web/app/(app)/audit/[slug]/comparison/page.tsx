import { channelsWithData, getComparisonView } from "@forgecy/audit";
import { comparisonChannels } from "@forgecy/core";
import { Card, CardDescription, CardHeader, CardTitle } from "@forgecy/ui";
import { Sparkles } from "lucide-react";
import { requestComparisonAction } from "../../actions";
import { ActionButton } from "../../_components/action-button";
import { ComparisonRow } from "../../_components/comparison-row";
import { sectionContext } from "../../_lib/findings";
import { channelLabel } from "../../_lib/labels";

export const metadata = { title: "Audit · Channel comparison" };

export default async function ComparisonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { db, audit, readOnly, aiAllowed } = await sectionContext(slug);
  const [rows, withData] = await Promise.all([
    getComparisonView(db, audit.id),
    channelsWithData(db, audit.id),
  ]);
  const ready = comparisonChannels.filter((c) => withData.includes(c));
  const missing = comparisonChannels.filter((c) => !withData.includes(c));

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader>
          <CardTitle>Website, Instagram and Facebook compared</CardTitle>
          <CardDescription>
            Five criteria: color, tone, call to action, audience and visual style. Every outcome is
            a proposal: if you change it, write why.
          </CardDescription>
        </CardHeader>
        <p className="text-body-sm">
          Channels with data: {ready.length ? ready.map((c) => channelLabel[c]).join(", ") : "none"}
          {missing.length ? (
            <span className="text-fg-muted">
              {" "}
              · without data: {missing.map((c) => channelLabel[c]).join(", ")}
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
                {rows.length ? "Update the comparison" : "Generate the comparison"}
              </ActionButton>
            </div>
          ) : (
            <p className="text-body-sm text-fg-muted">
              Data from at least two channels is needed: read the website or import the social data.
            </p>
          )
        ) : null}
        {!aiAllowed ? (
          <p className="text-body-sm text-fg-muted">
            This prospect’s policy does not allow AI: write the comparison as an “Across channels”
            observation in the diagnosis.
          </p>
        ) : null}
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
