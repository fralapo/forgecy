"use client";

import { FIXED_REPORT_SECTIONS, type ReportSection, type ReportSectionKey } from "@forgecy/core";
import { Badge, Button, Input, Label } from "@forgecy/ui";
import { ArrowDown, ArrowUp, Copy, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveReportDraftAction } from "../actions";
import { textareaClass } from "../_lib/styles";

export interface ReportFindingView {
  id: string;
  title: string;
  kind: string;
}

/** Sections whose bullets a person writes; the others list the audit findings. */
const WITH_BULLETS = new Set<ReportSectionKey>(["overview", "next_steps"]);
const NO_FINDINGS = new Set<ReportSectionKey>(["cover", "overview", "next_steps", "method"]);
const LIMITS = { intro: 420, nextStepsIntro: 240, bullet: 140, bullets: 5, emailBody: 2000 };

const linesOf = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * Report builder: order and switch sections, write intros and key messages, include
 * or exclude findings, edit the email. Everything is saved together with one button.
 */
export function ReportEditor({
  report,
  findings,
}: {
  report: {
    id: string;
    rev: number;
    sections: ReportSection[];
    excludedFindingIds: string[];
    emailSubject: string | null;
    emailBody: string | null;
    emailByAgent: boolean;
  };
  findings: Partial<Record<ReportSectionKey, ReportFindingView[]>>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sections, setSections] = useState(() =>
    report.sections.map((s) => ({ ...s, bulletsText: s.bullets.join("\n") })),
  );
  const [excluded, setExcluded] = useState(() => new Set(report.excludedFindingIds));
  const [subject, setSubject] = useState(report.emailSubject ?? "");
  const [body, setBody] = useState(report.emailBody ?? "");
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<{ error?: string; ok?: string }>({});
  const [seenRev, setSeenRev] = useState(report.rev);
  if (seenRev !== report.rev && !dirty) {
    // Saved here or changed elsewhere (e.g. texts from the agents): restart from the server.
    setSeenRev(report.rev);
    setSections(report.sections.map((s) => ({ ...s, bulletsText: s.bullets.join("\n") })));
    setExcluded(new Set(report.excludedFindingIds));
    setSubject(report.emailSubject ?? "");
    setBody(report.emailBody ?? "");
  }

  type Row = (typeof sections)[number];
  const change = <K extends keyof Row>(key: ReportSectionKey, field: K, value: Row[K]) => {
    setDirty(true);
    setSections((all) => all.map((s) => (s.key === key ? { ...s, [field]: value } : s)));
  };
  const move = (index: number, delta: -1 | 1) => {
    setDirty(true);
    setSections((all) => {
      const next = [...all];
      const [item] = next.splice(index, 1);
      if (item) next.splice(index + delta, 0, item);
      return next;
    });
  };
  const toggleFinding = (id: string, include: boolean) => {
    setDirty(true);
    setExcluded((prev) => {
      const next = new Set(prev);
      if (include) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = () =>
    start(async () => {
      setState({});
      const emailChanged =
        subject !== (report.emailSubject ?? "") || body !== (report.emailBody ?? "");
      const res = await saveReportDraftAction({
        id: report.id,
        rev: report.rev,
        sections: sections.map(({ bulletsText, ...s }) => ({
          ...s,
          bullets: WITH_BULLETS.has(s.key) ? linesOf(bulletsText) : s.bullets,
        })),
        excludedFindingIds: [...excluded],
        ...(emailChanged ? { emailSubject: subject, emailBody: body } : {}),
      });
      if (!res.ok) return setState({ error: res.error });
      setDirty(false);
      setState({ ok: "Modifiche salvate" });
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-col gap-3">
        {sections.map((s, i) => {
          const fixed = FIXED_REPORT_SECTIONS.includes(s.key);
          const list = findings[s.key] ?? [];
          const bulletCount = linesOf(s.bulletsText).length;
          const introMax = s.key === "next_steps" ? LIMITS.nextStepsIntro : LIMITS.intro;
          return (
            <li key={s.key} className="rounded-lg border border-subtle bg-surface">
              <div className="flex flex-wrap items-center gap-3 p-4">
                <input
                  type="checkbox"
                  aria-label={`Includi «${s.title}» nel report`}
                  checked={s.enabled}
                  disabled={fixed}
                  onChange={(e) => change(s.key, "enabled", e.target.checked)}
                />
                <span className="font-mono text-body-sm text-fg-muted">{i + 1}</span>
                <span className="flex-1 text-heading-sm text-fg">{s.title}</span>
                {s.byAgent ? <Badge variant="highlight">Testo proposto dall&apos;AI</Badge> : null}
                {fixed ? <span className="text-body-sm text-fg-muted">Sempre inclusa</span> : null}
                {!NO_FINDINGS.has(s.key) ? (
                  <span className="text-body-sm text-fg-muted">
                    {list.filter((f) => !excluded.has(f.id)).length} elementi
                  </span>
                ) : null}
                <span className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label={`Sposta su «${s.title}»`}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={i === sections.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={`Sposta giù «${s.title}»`}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                </span>
              </div>
              {s.enabled && s.key !== "cover" ? (
                <details className="border-t border-subtle px-4 py-3">
                  <summary className="cursor-pointer text-body-sm text-link">
                    Modifica testi{list.length && !NO_FINDINGS.has(s.key) ? " ed elementi" : ""}
                  </summary>
                  <div className="mt-3 flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`title-${s.key}`}>Titolo</Label>
                      <Input
                        id={`title-${s.key}`}
                        value={s.title}
                        maxLength={120}
                        onChange={(e) => change(s.key, "title", e.target.value)}
                      />
                    </div>
                    {s.key !== "method" ? (
                      <div className="flex flex-col gap-1">
                        <Label htmlFor={`intro-${s.key}`}>Introduzione</Label>
                        <textarea
                          id={`intro-${s.key}`}
                          value={s.intro}
                          maxLength={introMax}
                          className={textareaClass}
                          onChange={(e) => change(s.key, "intro", e.target.value)}
                        />
                        <span className="text-body-sm text-fg-muted">
                          {s.intro.length}/{introMax} caratteri
                        </span>
                      </div>
                    ) : (
                      <p className="text-body-sm text-fg-muted">
                        Il metodo elenca da solo le fonti usate: canali, pagine lette, competitor e
                        piano.
                      </p>
                    )}
                    {WITH_BULLETS.has(s.key) ? (
                      <div className="flex flex-col gap-1">
                        <Label htmlFor={`bullets-${s.key}`}>
                          {s.key === "overview" ? "Messaggi chiave" : "Prossimi passi"} (uno per
                          riga)
                        </Label>
                        <textarea
                          id={`bullets-${s.key}`}
                          value={s.bulletsText}
                          className={textareaClass}
                          onChange={(e) => change(s.key, "bulletsText", e.target.value)}
                        />
                        <span
                          className={
                            bulletCount > LIMITS.bullets
                              ? "text-body-sm text-error"
                              : "text-body-sm text-fg-muted"
                          }
                        >
                          {bulletCount}/{LIMITS.bullets} righe, al massimo {LIMITS.bullet} caratteri
                          l&apos;una
                        </span>
                      </div>
                    ) : null}
                    {list.length && !NO_FINDINGS.has(s.key) ? (
                      <fieldset className="flex flex-col gap-2">
                        <legend className="mb-1 text-label text-fg-muted">
                          Elementi nel report
                        </legend>
                        {list.map((f) => (
                          <label key={f.id} className="flex items-start gap-2 text-body-sm">
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={!excluded.has(f.id)}
                              onChange={(e) => toggleFinding(f.id, e.target.checked)}
                            />
                            <span>
                              {f.title}
                              {f.kind === "comparison" ? (
                                <span className="text-fg-muted"> · confronto</span>
                              ) : null}
                            </span>
                          </label>
                        ))}
                      </fieldset>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </li>
          );
        })}
      </ol>

      <section className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-heading-sm text-fg">Email di accompagnamento</h3>
          {report.emailByAgent && !dirty ? (
            <Badge variant="highlight">Proposta dal Copywriter</Badge>
          ) : null}
        </div>
        <p className="text-body-sm text-fg-muted">
          Forgecy non invia email: copia il testo nel tuo programma di posta.
          {!report.emailBody
            ? " Ancora vuota: scrivila qui oppure usa «Proponi i testi con l'AI», che prepara anche l'email."
            : ""}
        </p>
        <div className="flex flex-col gap-1">
          <Label htmlFor="email-subject">Oggetto</Label>
          <Input
            id="email-subject"
            value={subject}
            maxLength={160}
            onChange={(e) => {
              setDirty(true);
              setSubject(e.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="email-body">Testo</Label>
          <textarea
            id="email-body"
            value={body}
            maxLength={LIMITS.emailBody}
            className={`${textareaClass} min-h-48`}
            onChange={(e) => {
              setDirty(true);
              setBody(e.target.value);
            }}
          />
        </div>
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!body.trim()}
            onClick={() => {
              void navigator.clipboard
                .writeText(subject ? `${subject}\n\n${body}` : body)
                .then(() => setState({ ok: "Testo copiato" }))
                .catch(() => setState({ error: "Copia non riuscita: seleziona il testo a mano." }));
            }}
          >
            <Copy aria-hidden />
            Copia testo
          </Button>
        </div>
      </section>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-subtle bg-app py-3">
        <Button type="button" variant="primary" disabled={pending || !dirty} onClick={save}>
          <Save aria-hidden />
          {pending ? "Salvataggio…" : "Salva le modifiche"}
        </Button>
        {dirty ? <span className="text-body-sm text-fg-muted">Modifiche non salvate</span> : null}
        {state.error ? (
          <span role="alert" className="text-body-sm text-error">
            {state.error}
          </span>
        ) : state.ok ? (
          <span role="status" className="text-body-sm text-success">
            {state.ok}
          </span>
        ) : null}
      </div>
    </div>
  );
}
