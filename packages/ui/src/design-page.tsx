// Internal /design page: palette with computed contrasts, Brand Guard pairs, type scale, components.
// Server-component safe: no hooks, no event handlers, no "use client".
import { Download, Eye, GitMerge, Lock } from "lucide-react";
import type { ReactNode } from "react";
import tokensJson from "../tokens/forgecy.tokens.json";
import { AiProposal } from "./ai-proposal";
import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";
import { cn } from "./cn";
import { Input } from "./input";
import { Label } from "./label";
import {
  WCAG,
  checkContrast,
  evaluateBrandGuard,
  flattenTokens,
  formatRatio,
  resolveValue,
  tokenCssVar,
  tokenHex,
  type ContrastResult,
  type TokenTree,
} from "./tokens";

const tree = tokensJson as unknown as TokenTree;

interface Swatch {
  path: string;
  name: string;
  hex: string;
  cssVar: string;
  role: string;
  onWhite: number;
  onPorcelain: number;
}

function paletteSwatches(): Swatch[] {
  const tokens = flattenTokens(tree);
  const white = tokenHex(tokens, "color.white");
  const porcelain = tokenHex(tokens, "color.porcelain");
  return [...tokens.values()]
    .filter((t) => t.path.startsWith("color.") && t.type === "color")
    .map((t) => {
      const hex = tokenHex(tokens, t.path);
      const [name = t.path, role = ""] = (t.description ?? t.path).split(/:\s*/, 2);
      return {
        path: t.path,
        name,
        role,
        hex,
        cssVar: tokenCssVar(t.path),
        onWhite: checkContrast(hex, white),
        onPorcelain: checkContrast(hex, porcelain),
      };
    });
}

/** Allowed use derived from the computed ratio (never from a hardcoded table). */
function usage(ratio: number) {
  if (ratio >= WCAG.text) return <Badge variant="success">Testo</Badge>;
  if (ratio >= WCAG.nonText) return <Badge variant="warning">Testo grande e controlli</Badge>;
  return <Badge variant="neutral">Solo decorativo</Badge>;
}

// Literal class names so Tailwind can detect them when scanning this package.
const TYPE_SCALE = [
  {
    token: "heading-xl",
    className: "font-display text-heading-xl",
    sample: "Brand system per l'agenzia",
  },
  { token: "heading-lg", className: "font-display text-heading-lg", sample: "Audit del cliente" },
  {
    token: "heading-md",
    className: "font-display text-heading-md",
    sample: "Strategia dei contenuti",
  },
  { token: "heading-sm", className: "font-body text-heading-sm", sample: "Versione in revisione" },
  {
    token: "body-lg",
    className: "font-body text-body-lg",
    sample: "Ogni contenuto nasce da un processo con regole, versioni e controlli.",
  },
  {
    token: "body-md",
    className: "font-body text-body-md",
    sample: "Le persone decidono, l'AI propone. Ogni dato ha la sua fonte.",
  },
  {
    token: "body-sm",
    className: "font-body text-body-sm",
    sample: "Ultima modifica 5 ottobre 2026 alle 14:32.",
  },
  { token: "label", className: "font-body text-label uppercase", sample: "Etichetta di sezione" },
  {
    token: "mono-md",
    className: "font-mono text-mono-md",
    sample: "job_7f3a2c · skills/brand-audit",
  },
] as const;

function typeSpec(token: string): string {
  const v = resolveValue(flattenTokens(tree), `font.scale.${token}`) as {
    fontSize: { value: number };
    lineHeight: number;
    fontWeight: number;
    fontFamily: readonly string[];
  };
  return `${(v.fontFamily[0] ?? "").replace(/ Variable$/, "")} · ${v.fontSize.value}/${v.lineHeight} · ${v.fontWeight}`;
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-6 border-t border-subtle pt-12">
      <header className="flex flex-col gap-2">
        <h2 id={id} className="font-display text-heading-lg text-fg">
          {title}
        </h2>
        <p className="max-w-prose text-body-md text-fg-muted">{description}</p>
      </header>
      {children}
    </section>
  );
}

function GuardTable({ caption, rows }: { caption: string; rows: ContrastResult[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-subtle bg-surface">
      <table className="w-full border-collapse text-left text-body-sm">
        <caption className="px-4 py-3 text-left text-label uppercase text-fg-muted">
          {caption}
        </caption>
        <thead>
          <tr className="border-y border-subtle">
            <th scope="col" className="px-4 py-2 font-medium">
              Coppia
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Colori
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Contrasto
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Minimo
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Esito
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.theme}-${r.fg}-${r.bg}`}
              className="border-b border-subtle last:border-b-0"
            >
              <td className="px-4 py-2">{r.label}</td>
              <td className="px-4 py-2 font-mono text-mono-md">
                {r.fgHex} / {r.bgHex}
              </td>
              <td className="px-4 py-2" data-numeric>
                {formatRatio(r.ratio)}
              </td>
              <td className="px-4 py-2" data-numeric>
                {formatRatio(r.min)}
              </td>
              <td className="px-4 py-2">
                {r.pass ? (
                  <Badge variant="success">Superato</Badge>
                ) : (
                  <Badge variant="error">Non superato</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComponentShowcase({ idPrefix }: { idPrefix: string }) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary">Approva versione</Button>
        <Button variant="secondary">Apri confronto</Button>
        <Button variant="ghost">Annulla modifica</Button>
        <Button variant="danger">Elimina bozza</Button>
        <Button variant="secondary" size="icon" aria-label="Esporta" title="Esporta">
          <Download aria-hidden="true" strokeWidth={1.5} />
        </Button>
        <Button variant="primary" disabled>
          Pubblica (bloccato)
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="neutral">Bozza</Badge>
        <Badge variant="info" icon={Eye}>
          In revisione
        </Badge>
        <Badge variant="success">Approvato</Badge>
        <Badge variant="warning">Da verificare</Badge>
        <Badge variant="error" icon={Lock}>
          Bloccato
        </Badge>
        <Badge variant="error" icon={GitMerge}>
          Conflitto
        </Badge>
        <Badge variant="highlight">Novità</Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Nuovo cliente</CardTitle>
            <CardDescription>I campi con asterisco sono obbligatori.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${idPrefix}-name`}>Nome del cliente *</Label>
              <Input id={`${idPrefix}-name`} placeholder="Es. Rossi Arredamenti" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${idPrefix}-site`}>Sito web</Label>
              <Input
                id={`${idPrefix}-site`}
                type="url"
                aria-invalid="true"
                aria-describedby={`${idPrefix}-site-error`}
                defaultValue="rossi-arredamenti"
              />
              <p id={`${idPrefix}-site-error`} className="text-body-sm text-error">
                Indirizzo non valido: inserisci un URL completo, per esempio https://rossi.it.
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button variant="primary">Crea cliente</Button>
            <Button variant="ghost">Annulla</Button>
          </CardFooter>
        </Card>

        <AiProposal
          title="Scurisci il colore dei link"
          agent="brand-guard/contrast"
          sources={[
            {
              label: "WCAG 2.2, criterio 1.4.3",
              href: "https://www.w3.org/TR/WCAG22/#contrast-minimum",
            },
            { label: "tokens/forgecy.tokens.json" },
          ]}
        >
          Il link su porcellana arriva a 4,8:1. Propongo di usare Forge Blue 700 per tutto il testo
          blu.
        </AiProposal>
      </div>
    </div>
  );
}

export interface DesignPageProps {
  className?: string;
}

export function DesignPage({ className }: DesignPageProps) {
  const swatches = paletteSwatches();
  const guard = evaluateBrandGuard(tree);
  const failed = guard.filter((r) => !r.pass).length;

  return (
    <main className={cn("mx-auto flex max-w-6xl flex-col gap-12 px-6 py-12 text-fg", className)}>
      <header className="flex flex-col gap-4">
        <p className="text-label uppercase text-fg-muted">Identità visiva di Forgecy</p>
        <h1 className="font-display text-heading-xl">Sistema di design</h1>
        <p className="max-w-prose text-body-lg text-fg-muted">
          Colori, tipografia e componenti generati da{" "}
          <code className="font-mono text-mono-md text-fg">tokens/forgecy.tokens.json</code>. I
          contrasti sono calcolati dai token secondo WCAG 2.2.
        </p>
        <div>
          {failed === 0 ? (
            <Badge variant="success">
              Brand Guard: tutte le {guard.length} coppie superano il controllo
            </Badge>
          ) : (
            <Badge variant="error">Brand Guard: {failed} coppie non superano il controllo</Badge>
          )}
        </div>
      </header>

      <Section
        id="design-colori"
        title="Colori"
        description="Palette di riferimento con il contrasto calcolato su bianco e su porcellana."
      >
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {swatches.map((s) => (
            <li
              key={s.path}
              className="flex flex-col overflow-hidden rounded-lg border border-subtle bg-surface"
            >
              <div
                aria-hidden="true"
                className="h-24 border-b border-subtle"
                style={{ backgroundColor: `var(${s.cssVar})` }}
              />
              <div className="flex flex-col gap-2 p-4">
                <p className="text-heading-sm">{s.name}</p>
                {s.role ? <p className="text-body-sm text-fg-muted">{s.role}</p> : null}
                <p className="font-mono text-mono-md">
                  {s.hex} · {s.cssVar}
                </p>
                <dl className="grid grid-cols-[auto_auto_1fr] items-center gap-x-3 gap-y-2 text-body-sm">
                  <dt className="text-fg-muted">Bianco</dt>
                  <dd data-numeric>{formatRatio(s.onWhite)}</dd>
                  <dd>{usage(s.onWhite)}</dd>
                  <dt className="text-fg-muted">Porcellana</dt>
                  <dd data-numeric>{formatRatio(s.onPorcelain)}</dd>
                  <dd>{usage(s.onPorcelain)}</dd>
                </dl>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="design-brand-guard"
        title="Brand Guard"
        description="Coppie di token semantici verificate a ogni modifica dei token, in tema chiaro e scuro. Un esito negativo blocca il merge."
      >
        <GuardTable caption="Tema chiaro" rows={guard.filter((r) => r.theme === "light")} />
        <GuardTable caption="Tema scuro (v1)" rows={guard.filter((r) => r.theme === "dark")} />
      </Section>

      <Section
        id="design-tipografia"
        title="Tipografia"
        description="Space Grotesk per i titoli, Inter per testo e interfaccia, JetBrains Mono per i nomi tecnici."
      >
        <ul className="flex flex-col divide-y divide-subtle rounded-lg border border-subtle bg-surface">
          {TYPE_SCALE.map((t) => (
            <li
              key={t.token}
              className="flex flex-col gap-2 p-4 md:flex-row md:items-baseline md:gap-6"
            >
              <div className="flex shrink-0 flex-col gap-1 md:w-56">
                <code className="font-mono text-mono-md">{t.token}</code>
                <span className="text-body-sm text-fg-muted">{typeSpec(t.token)}</span>
              </div>
              <p className={t.className}>{t.sample}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="design-componenti"
        title="Componenti"
        description="Componenti shadcn/ui personalizzati solo tramite token."
      >
        <ComponentShowcase idPrefix="design-light" />
      </Section>

      <Section
        id="design-tema-scuro"
        title="Tema scuro (v1)"
        description='Gli stessi componenti dentro data-theme="dark": cambiano solo i token semantici.'
      >
        <div data-theme="dark" className="rounded-xl bg-app p-6 text-fg">
          <ComponentShowcase idPrefix="design-dark" />
        </div>
      </Section>
    </main>
  );
}
