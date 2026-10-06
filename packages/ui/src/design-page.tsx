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
  if (ratio >= WCAG.text) return <Badge variant="success">Text</Badge>;
  if (ratio >= WCAG.nonText) return <Badge variant="warning">Large text and controls</Badge>;
  return <Badge variant="neutral">Decorative only</Badge>;
}

// Literal class names so Tailwind can detect them when scanning this package.
const TYPE_SCALE = [
  {
    token: "heading-xl",
    className: "font-display text-heading-xl",
    sample: "A brand system for the agency",
  },
  { token: "heading-lg", className: "font-display text-heading-lg", sample: "Client audit" },
  {
    token: "heading-md",
    className: "font-display text-heading-md",
    sample: "Content strategy",
  },
  { token: "heading-sm", className: "font-body text-heading-sm", sample: "Version in review" },
  {
    token: "body-lg",
    className: "font-body text-body-lg",
    sample: "Every piece of content comes from a process with rules, versions and checks.",
  },
  {
    token: "body-md",
    className: "font-body text-body-md",
    sample: "People decide, the AI proposes. Every data point has its source.",
  },
  {
    token: "body-sm",
    className: "font-body text-body-sm",
    sample: "Last edited 5 October 2026 at 14:32.",
  },
  { token: "label", className: "font-body text-label uppercase", sample: "Section label" },
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
              Pair
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Colors
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Contrast
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Minimum
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Result
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
                  <Badge variant="success">Passed</Badge>
                ) : (
                  <Badge variant="error">Failed</Badge>
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
        <Button variant="primary">Approve version</Button>
        <Button variant="secondary">Open comparison</Button>
        <Button variant="ghost">Undo change</Button>
        <Button variant="danger">Delete draft</Button>
        <Button variant="secondary" size="icon" aria-label="Export" title="Export">
          <Download aria-hidden="true" strokeWidth={1.5} />
        </Button>
        <Button variant="primary" disabled>
          Publish (blocked)
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="neutral">Draft</Badge>
        <Badge variant="info" icon={Eye}>
          In review
        </Badge>
        <Badge variant="success">Approved</Badge>
        <Badge variant="warning">To check</Badge>
        <Badge variant="error" icon={Lock}>
          Blocked
        </Badge>
        <Badge variant="error" icon={GitMerge}>
          Conflict
        </Badge>
        <Badge variant="highlight">New</Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>New client</CardTitle>
            <CardDescription>Fields marked with an asterisk are required.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${idPrefix}-name`}>Client name *</Label>
              <Input id={`${idPrefix}-name`} placeholder="E.g. Rossi Arredamenti" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${idPrefix}-site`}>Website</Label>
              <Input
                id={`${idPrefix}-site`}
                type="url"
                aria-invalid="true"
                aria-describedby={`${idPrefix}-site-error`}
                defaultValue="rossi-arredamenti"
              />
              <p id={`${idPrefix}-site-error`} className="text-body-sm text-error">
                Invalid address: enter a full URL, for example https://rossi.it.
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button variant="primary">Create client</Button>
            <Button variant="ghost">Cancel</Button>
          </CardFooter>
        </Card>

        <AiProposal
          title="Darken the link color"
          agent="brand-guard/contrast"
          sources={[
            {
              label: "WCAG 2.2, criterion 1.4.3",
              href: "https://www.w3.org/TR/WCAG22/#contrast-minimum",
            },
            { label: "tokens/forgecy.tokens.json" },
          ]}
        >
          Links on porcelain reach 4.8:1. I propose using Forge Blue 700 for all blue text.
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
        <p className="text-label uppercase text-fg-muted">Forgecy visual identity</p>
        <h1 className="font-display text-heading-xl">Design system</h1>
        <p className="max-w-prose text-body-lg text-fg-muted">
          Colors, typography and components generated from{" "}
          <code className="font-mono text-mono-md text-fg">tokens/forgecy.tokens.json</code>.
          Contrast ratios are computed from the tokens according to WCAG 2.2.
        </p>
        <div>
          {failed === 0 ? (
            <Badge variant="success">Brand Guard: all {guard.length} pairs pass the check</Badge>
          ) : (
            <Badge variant="error">Brand Guard: {failed} pairs fail the check</Badge>
          )}
        </div>
      </header>

      <Section
        id="design-colors"
        title="Colors"
        description="Reference palette with the contrast computed on white and on porcelain."
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
                  <dt className="text-fg-muted">White</dt>
                  <dd data-numeric>{formatRatio(s.onWhite)}</dd>
                  <dd>{usage(s.onWhite)}</dd>
                  <dt className="text-fg-muted">Porcelain</dt>
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
        description="Semantic token pairs checked on every token change, in the light and dark themes. A failure blocks the merge."
      >
        <GuardTable caption="Light theme" rows={guard.filter((r) => r.theme === "light")} />
        <GuardTable caption="Dark theme (v1)" rows={guard.filter((r) => r.theme === "dark")} />
      </Section>

      <Section
        id="design-typography"
        title="Typography"
        description="Space Grotesk for headings, Inter for text and interface, JetBrains Mono for technical names."
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
        id="design-components"
        title="Components"
        description="shadcn/ui components customized only through tokens."
      >
        <ComponentShowcase idPrefix="design-light" />
      </Section>

      <Section
        id="design-dark-theme"
        title="Dark theme (v1)"
        description='The same components inside data-theme="dark": only the semantic tokens change.'
      >
        <div data-theme="dark" className="rounded-xl bg-app p-6 text-fg">
          <ComponentShowcase idPrefix="design-dark" />
        </div>
      </Section>
    </main>
  );
}
