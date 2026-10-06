"use client";

import { Button } from "@forgecy/ui";
import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { exportAction } from "../actions";

type Output = "png" | "pdf" | "zip";
const OUTPUTS: { value: Output; label: string }[] = [
  { value: "png", label: "Immagini PNG" },
  { value: "pdf", label: "PDF" },
  { value: "zip", label: "Pacchetto ZIP (immagini, testi e didascalia)" },
];

/** Export request: draft (watermarked, any time) or final (approved version only). */
export function CarouselExportForm({
  slug,
  clientId,
  contentId,
  canFinal,
  approvedVersion,
  disabled,
}: {
  slug: string;
  clientId: string;
  contentId: string;
  canFinal: boolean;
  approvedVersion: number | null;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState(!canFinal);
  const [outputs, setOutputs] = useState<Output[]>(["zip"]);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        start(async () => {
          const r = await exportAction({ slug, clientId, id: contentId, draft, outputs });
          if (!r.ok)
            return setMessage({
              error: true,
              text:
                r.code === "EXPORT-NOT-APPROVED"
                  ? "La versione finale si esporta solo da un carosello approvato."
                  : r.error,
            });
          setMessage({ error: false, text: "Esportazione in coda: i file compaiono qui sotto." });
          router.refresh();
        });
      }}
    >
      <fieldset disabled={disabled || pending} className="grid gap-4">
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-label text-fg">Versione</legend>
          <label className="flex items-center gap-2 text-body-sm text-fg">
            <input type="radio" name="ex-kind" checked={draft} onChange={() => setDraft(true)} />
            Bozza (con filigrana, dalla bozza attuale)
          </label>
          <label className="flex items-center gap-2 text-body-sm text-fg">
            <input
              type="radio"
              name="ex-kind"
              checked={!draft}
              disabled={!canFinal}
              onChange={() => setDraft(false)}
            />
            Finale{approvedVersion ? ` (versione approvata v${approvedVersion})` : ""}
          </label>
          {!canFinal ? (
            <p className="text-body-sm text-fg-muted">
              La versione finale è disponibile dopo l&apos;approvazione.
            </p>
          ) : null}
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-label text-fg">File</legend>
          {OUTPUTS.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-body-sm text-fg">
              <input
                type="checkbox"
                checked={outputs.includes(o.value)}
                onChange={(e) =>
                  setOutputs((cur) =>
                    e.target.checked ? [...cur, o.value] : cur.filter((x) => x !== o.value),
                  )
                }
              />
              {o.label}
            </label>
          ))}
        </fieldset>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={disabled || pending || outputs.length === 0}>
          <Download aria-hidden />
          Esporta
        </Button>
        {message ? (
          <span
            role={message.error ? "alert" : "status"}
            className={message.error ? "text-body-sm text-error" : "text-body-sm text-fg-muted"}
          >
            {message.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}
