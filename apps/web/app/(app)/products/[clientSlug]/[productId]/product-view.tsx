"use client";

import type { ConfidenceLevel, ProductStatus } from "@forgecy/core";
import {
  fieldDefs,
  isEmptyValue,
  LIMITS,
  sectionLabels,
  type FieldDef,
  type FieldKey,
  type ProductFields,
  type ProductVariant,
} from "@forgecy/catalog/fields";
import { claimLabels, type ClaimKind } from "@forgecy/catalog/sensitive";
import { Badge, Button, Card, cn } from "@forgecy/ui";
import {
  BadgeCheck,
  ExternalLink,
  ImagePlus,
  ScanEye,
  ShieldAlert,
  Sparkles,
  User,
} from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ActionMessage, ConfirmDialog, useCatalogAction } from "../../_components/client";
import { Banner, Thumb, textareaClass } from "../../_components/ui";
import { fromText, toText } from "../../_lib/field-text";
import { confidenceText } from "../../_lib/labels";
import { transitionAction } from "../actions";
import {
  acceptSensitiveAction,
  decideProposalAction,
  deleteAction,
  duplicateAction,
  imageAction,
  saveFieldAction,
} from "./actions";

interface FieldMetaView {
  truth: "observed" | "proposed" | "approved";
  confidence: ConfidenceLevel;
  source: string;
  sensitive: ClaimKind[];
  accepted: boolean;
  page: number | null;
  fileId: string | null;
}

export interface ProductViewData {
  clientId: string;
  clientSlug: string;
  clientName: string;
  id: string;
  name: string;
  status: ProductStatus;
  revision: number;
  byAgent: boolean;
  fields: ProductFields;
  meta: Partial<Record<string, FieldMetaView | undefined>>;
  blockers: string[];
  pendingSensitive: FieldKey[];
  images: Array<{
    id: string;
    url: string | null;
    alt: string;
    fileName: string;
    status: "draft" | "approved";
    isPrimary: boolean;
    method: string;
    confidence: ConfidenceLevel;
  }>;
  proposals: Array<{
    id: string;
    field: FieldKey;
    label: string;
    current: string;
    proposed: string;
    proposedRaw: unknown;
    source: string;
    status: string;
    when: string;
    decidedBy: string | null;
  }>;
  history: Array<{
    id: string;
    label: string;
    who: string;
    when: string;
    field: string | null;
    note: string | null;
  }>;
  sources: Array<{ label: string; href: string; external: boolean; fileId?: string }>;
  approvedBy: string | null;
  approvedAt: string | null;
  createdBy: string | null;
  sourceImportHref: Route | null;
}

const methodLabels: Record<string, string> = {
  folder: "abbinata per cartella",
  filename: "abbinata per nome file",
  sku: "abbinata per SKU",
  sheet: "indicata nel foglio",
  ai: "abbinata da Brand Analyst",
  manual: "aggiunta a mano",
};

type Tab = "sources" | "proposals" | "history" | "usage";

export function ProductView({ data }: { data: ProductViewData }) {
  const router = useRouter();
  const action = useCatalogAction();
  const [tab, setTab] = useState<Tab>(
    data.proposals.some((p) => p.status === "proposed") ? "proposals" : "history",
  );
  const open = data.proposals.filter((p) => p.status === "proposed");
  const base = { clientId: data.clientId };
  const transition = (
    a: "approve" | "reject" | "archive" | "to_draft" | "restore",
    note?: string,
  ) =>
    action.run(() =>
      transitionAction({
        ...base,
        ids: [data.id],
        action: a,
        note,
        revisions: { [data.id]: data.revision },
      }),
    );
  const missing = fieldDefs
    .filter((f) => ["shortDescription", "benefits", "materials", "usage"].includes(f.key))
    .filter((f) => isEmptyValue(data.fields[f.key]))
    .map((f) => f.label.toLowerCase());
  if (data.images.length === 0) missing.push("immagini");

  const nextAction = open.length
    ? `tu · Accetta o rifiuta ${open.length === 1 ? "1 campo proposto" : `${open.length} campi proposti`}`
    : data.pendingSensitive.length
      ? `tu · Accetta ${data.pendingSensitive.length === 1 ? "il campo sensibile" : `${data.pendingSensitive.length} campi sensibili`}`
      : missing.length
        ? `tu · Completa i campi mancanti: ${missing.join(", ")}`
        : data.status === "approved"
          ? "Nessuna azione in sospeso"
          : "tu · Approva il prodotto";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-fg-muted">
          <span className="font-medium text-fg">Prossima azione: </span>
          {nextAction}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {data.status === "draft" || data.status === "proposed" ? (
            <ConfirmDialog
              title={`Approvare «${data.name}»?`}
              confirmLabel="Approva prodotto"
              disabled={data.blockers.length > 0}
              onConfirm={(f) => transition("approve", String(f.get("note") ?? ""))}
              trigger={(openDialog) => (
                <Button
                  onClick={openDialog}
                  disabled={action.pending || data.blockers.length > 0}
                  title={data.blockers[0]}
                >
                  <BadgeCheck aria-hidden />
                  Approva prodotto
                </Button>
              )}
            >
              <p>
                Descrizione, scheda tecnica e foto approvate diventano utilizzabili nella strategia
                e nei caroselli di {data.clientName}.
              </p>
              <label className="block text-body-sm text-fg">
                Nota (facoltativa)
                <textarea
                  name="note"
                  rows={2}
                  maxLength={1000}
                  className={cn(textareaClass, "mt-1")}
                />
              </label>
            </ConfirmDialog>
          ) : null}
          {data.status === "approved" && open.length ? (
            <Button onClick={() => setTab("proposals")}>Rivedi proposte</Button>
          ) : null}
          {data.status === "rejected" ? (
            <Button onClick={() => transition("to_draft")} disabled={action.pending}>
              Riporta in bozza
            </Button>
          ) : null}
          {data.status === "archived" ? (
            <Button onClick={() => transition("restore")} disabled={action.pending}>
              Ripristina prodotto
            </Button>
          ) : null}
          {data.status === "draft" || data.status === "proposed" ? (
            <ConfirmDialog
              title={`Rifiutare «${data.name}»?`}
              confirmLabel="Rifiuta prodotto"
              onConfirm={(f) => transition("reject", String(f.get("note") ?? ""))}
              trigger={(openDialog) => (
                <Button variant="secondary" onClick={openDialog} disabled={action.pending}>
                  Rifiuta prodotto
                </Button>
              )}
            >
              <label className="block text-body-sm text-fg">
                Motivo (facoltativo)
                <textarea
                  name="note"
                  rows={2}
                  maxLength={1000}
                  className={cn(textareaClass, "mt-1")}
                />
              </label>
            </ConfirmDialog>
          ) : null}
          <Button
            variant="secondary"
            disabled={action.pending}
            onClick={() =>
              action.run(() =>
                duplicateAction({ ...base, clientSlug: data.clientSlug, productId: data.id }),
              )
            }
          >
            Duplica prodotto
          </Button>
          {data.sourceImportHref ? (
            <Button asChild variant="ghost">
              <Link href={data.sourceImportHref}>Apri import d&apos;origine</Link>
            </Button>
          ) : null}
          {data.status !== "archived" ? (
            <ConfirmDialog
              title={`Archiviare «${data.name}»?`}
              confirmLabel="Archivia prodotto"
              danger
              onConfirm={() => transition("archive")}
              trigger={(openDialog) => (
                <Button variant="ghost" onClick={openDialog} disabled={action.pending}>
                  Archivia prodotto
                </Button>
              )}
            >
              <p>
                Non sarà più selezionabile nei brief. I caroselli che lo usano restano invariati.
              </p>
            </ConfirmDialog>
          ) : null}
          <ConfirmDialog
            title={`Eliminare «${data.name}»?`}
            confirmLabel="Elimina prodotto"
            danger
            onConfirm={(f) =>
              action.run(() =>
                deleteAction({
                  ...base,
                  clientSlug: data.clientSlug,
                  productId: data.id,
                  typedName: String(f.get("typedName") ?? ""),
                }),
              )
            }
            trigger={(openDialog) => (
              <Button variant="ghost" onClick={openDialog} disabled={action.pending}>
                Elimina definitivamente
              </Button>
            )}
          >
            <p>
              Campi, cronologia e collegamenti alle immagini vengono cancellati; le immagini restano
              negli asset. Digita il nome del prodotto per confermare.
            </p>
            <input
              name="typedName"
              required
              aria-label="Nome del prodotto"
              autoComplete="off"
              className={textareaClass}
            />
          </ConfirmDialog>
        </div>
      </div>
      <ActionMessage result={action.result} />
      {data.status === "draft" && data.blockers.length ? (
        <Banner tone="warning">
          Bozza: completa nome, categoria e descrizione breve per poterla approvare.
        </Banner>
      ) : null}
      {data.status === "approved" && action.result?.message === "Salvato" ? (
        <Banner tone="warning">
          Hai modificato un prodotto approvato. Controlla i caroselli e le rubriche che lo usano.
        </Banner>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Gallery data={data} onChanged={() => router.refresh()} />
          {(Object.keys(sectionLabels) as FieldDef["section"][]).map((section) => (
            <Section key={section} section={section} data={data} />
          ))}
        </div>
        <aside aria-label="Dettagli" className="space-y-3">
          <div role="tablist" aria-label="Pannello" className="flex flex-wrap gap-1">
            {(
              [
                ["sources", "Fonti"],
                ["proposals", `Proposte${open.length ? ` (${open.length})` : ""}`],
                ["history", "Cronologia"],
                ["usage", "Usato in"],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                role="tab"
                aria-selected={tab === id}
                size="sm"
                variant={tab === id ? "secondary" : "ghost"}
                onClick={() => setTab(id)}
              >
                {label}
              </Button>
            ))}
          </div>
          <Card className="gap-3 p-4" role="tabpanel">
            {tab === "sources" ? (
              <ul className="space-y-2 text-body-sm">
                {data.createdBy ? (
                  <li className="text-fg-muted">Creato da {data.createdBy}</li>
                ) : null}
                {data.approvedBy ? (
                  <li className="text-fg-muted">
                    Approvato da {data.approvedBy} · {data.approvedAt}
                  </li>
                ) : null}
                {data.sources.length === 0 ? (
                  <li className="text-fg-muted">Inserito a mano.</li>
                ) : null}
                {data.sources.map((s) => (
                  <li key={s.href}>
                    {s.external ? (
                      <a
                        href={s.href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-link hover:underline"
                      >
                        {s.label}
                        <ExternalLink aria-hidden className="size-4" />
                      </a>
                    ) : (
                      <Link href={s.href as Route} className="text-link hover:underline">
                        {s.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            {tab === "proposals" ? (
              data.proposals.length === 0 ? (
                <p className="text-body-sm text-fg-muted">Nessuna proposta di campo.</p>
              ) : (
                <ul className="space-y-3">
                  {data.proposals.map((p) => (
                    <li key={p.id} className="border-b border-subtle pb-3 last:border-0">
                      <ProposalDiff p={p} clientId={data.clientId} />
                    </li>
                  ))}
                </ul>
              )
            ) : null}
            {tab === "history" ? (
              <ol className="space-y-2 text-body-sm">
                {data.history.map((h) => (
                  <li key={h.id}>
                    <span className="text-fg">
                      {h.label}
                      {h.field ? ` · ${h.field}` : ""}
                    </span>
                    <span className="block text-fg-muted">
                      {h.who} · {h.when}
                    </span>
                    {h.note ? <span className="block text-fg-muted">«{h.note}»</span> : null}
                  </li>
                ))}
              </ol>
            ) : null}
            {tab === "usage" ? (
              <p className="text-body-sm text-fg-muted">
                Nessuna voce della strategia e nessun carosello usa ancora questo prodotto.
              </p>
            ) : null}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Gallery({ data, onChanged }: { data: ProductViewData; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const action = useCatalogAction();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    for (const file of Array.from(files)) {
      const res = await fetch(`/products/${data.clientSlug}/${data.id}/images`, {
        method: "POST",
        body: file,
        headers: { "x-file-name": encodeURIComponent(file.name) },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? `«${file.name}» non è stata caricata.`);
      }
    }
    setUploading(false);
    if (input.current) input.current.value = "";
    onChanged();
  }
  const img = (id: string, a: "primary" | "unlink" | "approve") =>
    action.run(() => imageAction({ clientId: data.clientId, imageId: id, action: a }));
  return (
    <Card className="gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-heading-sm">Foto</h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => input.current?.click()}
          disabled={uploading}
        >
          <ImagePlus aria-hidden />
          {uploading ? "Caricamento…" : "Aggiungi immagine"}
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(e) => void upload(e.target.files)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
      <ActionMessage result={action.result} />
      {data.images.length === 0 ? (
        <p className="text-body-sm text-fg-muted">Nessuna immagine collegata.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-4">
          {data.images.map((i) => (
            <li key={i.id} className="space-y-2">
              <Thumb url={i.url} alt={i.alt} size="lg" />
              <div className="flex flex-wrap gap-1">
                {i.isPrimary ? <Badge variant="info">Principale</Badge> : null}
                <Badge variant={i.status === "approved" ? "success" : "neutral"}>
                  {i.status === "approved" ? "Approvato" : "Bozza"}
                </Badge>
              </div>
              <p className="text-body-sm text-fg-muted">
                {i.fileName} · {methodLabels[i.method] ?? i.method}
                {i.method === "ai" ? ` · confidenza ${confidenceText[i.confidence]}` : ""}
              </p>
              {i.status === "draft" ? (
                <p className="text-body-sm text-fg-muted">Approvala per usarla nei caroselli.</p>
              ) : null}
              <div className="flex flex-wrap gap-1">
                {i.status === "draft" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => img(i.id, "approve")}
                    disabled={action.pending}
                  >
                    Approva
                  </Button>
                ) : null}
                {!i.isPrimary ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => img(i.id, "primary")}
                    disabled={action.pending}
                  >
                    Imposta come principale
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => img(i.id, "unlink")}
                  disabled={action.pending}
                >
                  Scollega
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Section({ section, data }: { section: FieldDef["section"]; data: ProductViewData }) {
  const defs = fieldDefs.filter((f) => f.section === section);
  const empty = defs.every((f) => isEmptyValue(data.fields[f.key]));
  const body = (
    <div className="space-y-4">
      {section === "specs" && empty ? (
        <p className="text-body-sm text-fg-muted">
          Aggiungi ingredienti o materiali, formati e istruzioni d&apos;uso: il Copywriter li usa
          per descrivere il prodotto.
        </p>
      ) : null}
      {section === "commercial" ? (
        <p className="text-body-sm text-fg-muted">
          Il Copywriter usa il prezzo solo se è in questo prodotto approvato e il brief lo chiede.
        </p>
      ) : null}
      {defs.map((def) => (
        <FieldRow key={def.key} def={def} data={data} />
      ))}
    </div>
  );
  if (section === "commercial")
    return (
      <Card>
        <details open={!empty}>
          <summary className="cursor-pointer text-heading-sm">
            {sectionLabels[section]}
            {empty ? (
              <span className="ml-2 text-body-sm text-fg-muted">Nessun dato commerciale</span>
            ) : null}
          </summary>
          <div className="mt-4">{body}</div>
        </details>
      </Card>
    );
  return (
    <Card>
      <h2 className="text-heading-sm">{sectionLabels[section]}</h2>
      {body}
    </Card>
  );
}

function FieldRow({ def, data }: { def: FieldDef; data: ProductViewData }) {
  const value = data.fields[def.key];
  const meta = data.meta[def.key];
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() => toText(def, value));
  const action = useCatalogAction();
  const proposals = data.proposals.filter((p) => p.field === def.key && p.status === "proposed");
  const id = `field-${def.key}`;
  const multiline = def.kind !== "text";
  const max =
    def.key === "shortDescription"
      ? LIMITS.shortDescription
      : def.key === "longDescription"
        ? LIMITS.longDescription
        : undefined;
  const pendingSensitive = !!meta?.sensitive.length && !meta.accepted && !isEmptyValue(value);
  const pdfSource = meta?.fileId ? data.sources.find((s) => s.fileId === meta.fileId) : undefined;

  function save() {
    action.run(
      () =>
        saveFieldAction({
          clientId: data.clientId,
          productId: data.id,
          revision: data.revision,
          field: def.key,
          value: fromText(def, text),
        }),
      (r) => r.ok && setEditing(false),
    );
  }

  return (
    <div id={id} className="border-b border-subtle pb-4 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <label htmlFor={`${id}-input`} className="text-label font-medium text-fg">
          {def.label}
          {def.kind === "list" || def.kind === "tags" ? (
            <span className="ml-1 font-normal text-fg-muted">(una voce per riga)</span>
          ) : null}
          {def.kind === "variants" ? (
            <span className="ml-1 font-normal text-fg-muted">
              (attributo | valore | SKU, una per riga)
            </span>
          ) : null}
        </label>
        {!editing ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Modifica<span className="sr-only"> {def.label}</span>
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          {multiline ? (
            <textarea
              id={`${id}-input`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={def.kind === "longtext" ? 4 : 3}
              maxLength={max}
              placeholder={def.placeholder}
              className={textareaClass}
              onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            />
          ) : (
            <input
              id={`${id}-input`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className={cn(textareaClass, def.key === "sku" && "font-mono")}
              onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            />
          )}
          {max ? (
            <p className="text-body-sm text-fg-muted">
              {text.length} / {max}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={action.pending}>
              {action.pending ? "Salvataggio…" : "Salva"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              Annulla
            </Button>
          </div>
        </div>
      ) : isEmptyValue(value) ? (
        <p className="mt-1 text-body-sm text-fg-muted">{def.placeholder ?? "—"}</p>
      ) : (
        <FieldValue def={def} value={value} />
      )}
      <ActionMessage result={action.result} />
      {meta && !isEmptyValue(value) ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-body-sm text-fg-muted">
          <TruthBadge truth={meta.truth} byAgent={meta.source.startsWith("Proposto da")} />
          <span>{meta.source}</span>
          <span>· confidenza {confidenceText[meta.confidence]}</span>
          {pdfSource && meta.page ? (
            <a
              href={`${pdfSource.href}#page=${meta.page}`}
              target="_blank"
              rel="noreferrer"
              className="text-link hover:underline"
            >
              Apri fonte
            </a>
          ) : null}
        </div>
      ) : null}
      {meta?.sensitive.length && !isEmptyValue(value) ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="warning" icon={ShieldAlert}>
            Sensibile · {meta.sensitive.map((k) => claimLabels[k]).join(", ")}
          </Badge>
          {pendingSensitive ? (
            <ConfirmDialog
              title={`Accettare «${def.label}»?`}
              confirmLabel="Accetta campo"
              onConfirm={(f) =>
                action.run(() =>
                  acceptSensitiveAction({
                    clientId: data.clientId,
                    productId: data.id,
                    field: def.key,
                    note: String(f.get("note") ?? ""),
                  }),
                )
              }
              trigger={(openDialog) => (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={openDialog}
                  disabled={action.pending}
                >
                  Accetta campo sensibile
                </Button>
              )}
            >
              <p>Confermi che il valore è corretto e si può usare nei contenuti.</p>
              <label className="block text-body-sm text-fg">
                Nota{" "}
                {meta.confidence === "low" ? "(obbligatoria: confidenza Bassa)" : "(facoltativa)"}
                <textarea
                  name="note"
                  rows={2}
                  required={meta.confidence === "low"}
                  maxLength={1000}
                  className={cn(textareaClass, "mt-1")}
                />
              </label>
            </ConfirmDialog>
          ) : (
            <span className="text-body-sm text-fg-muted">Accettato</span>
          )}
        </div>
      ) : null}
      {proposals.map((p) => (
        <div key={p.id} className="mt-3 rounded-md border border-dashed border-primary p-3">
          <ProposalDiff p={p} clientId={data.clientId} />
        </div>
      ))}
    </div>
  );
}

function FieldValue({ def, value }: { def: FieldDef; value: unknown }) {
  if (def.kind === "variants")
    return (
      <table className="mt-1 text-body-sm">
        <thead className="text-fg-muted">
          <tr>
            <th scope="col" className="pr-4 text-left font-medium">
              Attributo
            </th>
            <th scope="col" className="pr-4 text-left font-medium">
              Valore
            </th>
            <th scope="col" className="text-left font-medium">
              SKU variante
            </th>
          </tr>
        </thead>
        <tbody>
          {(value as ProductVariant[]).map((v, i) => (
            <tr key={i}>
              <td className="pr-4">{v.attribute}</td>
              <td className="pr-4">{v.value}</td>
              <td className="font-mono">{v.sku ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  if (Array.isArray(value))
    return (
      <ul className="mt-1 list-disc pl-5 text-body-md text-fg">
        {value.map((v, i) => (
          <li key={i}>{String(v)}</li>
        ))}
      </ul>
    );
  return (
    <p
      className={cn(
        "mt-1 whitespace-pre-line text-body-md text-fg",
        def.key === "sku" && "font-mono",
      )}
    >
      {String(value)}
    </p>
  );
}

function TruthBadge({ truth, byAgent }: { truth: FieldMetaView["truth"]; byAgent: boolean }) {
  if (truth === "approved")
    return (
      <Badge variant="success" icon={BadgeCheck}>
        Approvato
      </Badge>
    );
  if (truth === "proposed")
    return (
      <Badge variant="info" icon={byAgent ? Sparkles : User} className="border-dashed">
        Proposto
      </Badge>
    );
  return (
    <Badge variant="neutral" icon={ScanEye} className="border-dashed">
      Estratto, non rivisto
    </Badge>
  );
}

function ProposalDiff({
  p,
  clientId,
}: {
  p: ProductViewData["proposals"][number];
  clientId: string;
}) {
  const action = useCatalogAction();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(p.proposed);
  const decide = (decision: "accept" | "reject", editedValue?: unknown) =>
    action.run(() => decideProposalAction({ clientId, proposalId: p.id, decision, editedValue }));
  const def = fieldDefs.find((f) => f.key === p.field);
  return (
    <div className="space-y-2 text-body-sm">
      <p className="font-medium text-fg">
        {p.label} ·{" "}
        <span className="font-normal text-fg-muted">
          {p.source} · {p.when}
        </span>
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-fg-muted">Valore attuale</dt>
        <dd className="text-fg">{p.current || "—"}</dd>
        <dt className="text-fg-muted">Valore proposto</dt>
        <dd className="text-fg">{p.proposed || "—"}</dd>
      </dl>
      {p.status === "proposed" ? (
        <>
          {editing && def ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              aria-label={`Valore da accettare per ${p.label}`}
              className={textareaClass}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={action.pending}
              onClick={() =>
                editing && def
                  ? decide("accept", fromText(def, text.replace(/; /g, "\n")))
                  : decide("accept")
              }
            >
              Accetta<span className="sr-only"> {p.label}</span>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={action.pending}
              onClick={() => decide("reject")}
            >
              Rifiuta<span className="sr-only"> {p.label}</span>
            </Button>
            {!editing ? (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Modifica e accetta<span className="sr-only"> {p.label}</span>
              </Button>
            ) : null}
          </div>
          <ActionMessage result={action.result} />
        </>
      ) : (
        <p className="text-fg-muted">
          {p.status === "accepted"
            ? "Accettata"
            : p.status === "rejected"
              ? "Rifiutata"
              : "Superata"}
          {p.decidedBy ? ` da ${p.decidedBy}` : ""}
        </p>
      )}
    </div>
  );
}
