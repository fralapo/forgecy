import type { FieldChange } from "@forgecy/brand";
import { Badge } from "@forgecy/ui";
import { formatValue } from "../_lib/labels";

const kindLabel = { added: "Aggiunto", removed: "Rimosso", changed: "Modificato" } as const;

export function DiffList({ changes }: { changes: FieldChange[] }) {
  if (!changes.length) return <p className="text-body-sm text-fg-muted">Nessuna differenza.</p>;
  return (
    <ul className="divide-y divide-subtle">
      {changes.map((c, i) => (
        <li
          key={`${c.pointer}-${i}`}
          className="grid gap-2 py-3 text-body-sm md:grid-cols-[14rem_1fr_1fr]"
        >
          <div className="space-y-1">
            <p className="text-fg">{c.label}</p>
            <div className="flex flex-wrap gap-1">
              <Badge>{kindLabel[c.kind]}</Badge>
              {c.sensitive ? <Badge variant="warning">Sensibile</Badge> : null}
            </div>
          </div>
          <p className="whitespace-pre-wrap text-fg-muted">
            <span className="sr-only">Prima: </span>
            {formatValue(c.before)}
          </p>
          <p className="whitespace-pre-wrap text-fg">
            <span className="sr-only">Dopo: </span>
            {formatValue(c.after)}
          </p>
        </li>
      ))}
    </ul>
  );
}
