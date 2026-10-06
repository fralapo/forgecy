import { channelsWithData, getComparisonView } from "@forgecy/audit";
import { comparisonChannels } from "@forgecy/core";
import { Card, CardDescription, CardHeader, CardTitle } from "@forgecy/ui";
import { Sparkles } from "lucide-react";
import { requestComparisonAction } from "../../actions";
import { ActionButton } from "../../_components/action-button";
import { ComparisonRow } from "../../_components/comparison-row";
import { sectionContext } from "../../_lib/findings";
import { channelLabel } from "../../_lib/labels";

export const metadata = { title: "Audit · Confronto tra canali" };

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
          <CardTitle>Sito, Instagram e Facebook a confronto</CardTitle>
          <CardDescription>
            Cinque criteri: colore, tono, call to action, pubblico e stile visivo. Ogni esito è una
            proposta: se lo cambi, scrivi perché.
          </CardDescription>
        </CardHeader>
        <p className="text-body-sm">
          Canali con dati: {ready.length ? ready.map((c) => channelLabel[c]).join(", ") : "nessuno"}
          {missing.length ? (
            <span className="text-fg-muted">
              {" "}
              · senza dati: {missing.map((c) => channelLabel[c]).join(", ")}
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
                {rows.length ? "Aggiorna il confronto" : "Genera il confronto"}
              </ActionButton>
            </div>
          ) : (
            <p className="text-body-sm text-fg-muted">
              Servono dati su almeno due canali: leggi il sito o importa i dati dei social.
            </p>
          )
        ) : null}
        {!aiAllowed ? (
          <p className="text-body-sm text-fg-muted">
            La policy di questo prospect non permette l&apos;AI: il confronto si scrive come
            osservazione “Tra i canali” nella diagnosi.
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
