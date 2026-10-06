// Internal /design page: palette with computed contrasts, Brand Guard pairs, type scale, components.
// Server-component safe: no hooks, no event handlers, no "use client".
// Framework-agnostic: every text comes from the `texts` prop, built by the app in the user's language.
import { Download, Eye, GitMerge, Lock } from "lucide-react";
import type { ReactNode } from "react";
import tokensJson from "../tokens/forgecy.tokens.json";
import { AiProposal, type AiProposalTexts } from "./ai-proposal";
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
  resolveValue,
  tokenCssVar,
  tokenHex,
  type ContrastPair,
  type ContrastResult,
  type TokenTree,
} from "./tokens";

const tree = tokensJson as unknown as TokenTree;

// Literal class names so Tailwind can detect them when scanning this package.
const TYPE_SCALE = [
  { token: "heading-xl", className: "font-display text-heading-xl" },
  { token: "heading-lg", className: "font-display text-heading-lg" },
  { token: "heading-md", className: "font-display text-heading-md" },
  { token: "heading-sm", className: "font-body text-heading-sm" },
  { token: "body-lg", className: "font-body text-body-lg" },
  { token: "body-md", className: "font-body text-body-md" },
  { token: "body-sm", className: "font-body text-body-sm" },
  { token: "label", className: "font-body text-label uppercase" },
  { token: "mono-md", className: "font-mono text-mono-md" },
] as const;

export type DesignTypeToken = (typeof TYPE_SCALE)[number]["token"];

/** Every text of the design page, in the viewer's language. */
export interface DesignPageTexts {
  kicker: string;
  title: string;
  /** Intro paragraph (may contain markup such as the tokens file name). */
  intro: ReactNode;
  guardAllPass: (count: number) => string;
  guardSomeFail: (count: number) => string;
  /** A contrast ratio, e.g. "4.8:1". */
  ratio: (value: number) => string;
  usage: { text: string; largeText: string; decorative: string };
  colors: { title: string; description: string; onWhite: string; onPorcelain: string };
  /** Translated name and role of a color token (`color.forge-blue`); undefined keeps the token's own. */
  swatch: (path: string) => { name?: string; role?: string };
  brandGuard: {
    title: string;
    description: string;
    lightCaption: string;
    darkCaption: string;
    pair: string;
    colors: string;
    contrast: string;
    minimum: string;
    result: string;
    passed: string;
    failed: string;
  };
  /** Name of a Brand Guard pair; falls back to the pair's own label when undefined. */
  pairLabel: (pair: ContrastPair) => string | undefined;
  typography: {
    title: string;
    description: string;
    samples: Record<DesignTypeToken, string>;
  };
  components: { title: string; description: string };
  darkTheme: { title: string; description: string };
  showcase: {
    approve: string;
    compare: string;
    undo: string;
    deleteDraft: string;
    export: string;
    publishBlocked: string;
    badge: {
      draft: string;
      inReview: string;
      approved: string;
      toCheck: string;
      blocked: string;
      conflict: string;
      new: string;
    };
    form: {
      title: string;
      description: string;
      name: string;
      namePlaceholder: string;
      website: string;
      websiteError: string;
      create: string;
      cancel: string;
    };
    proposal: { title: string; body: string; wcagSource: string };
  };
  aiProposal: AiProposalTexts;
}

interface Swatch {
  path: string;
  name: string;
  hex: string;
  cssVar: string;
  role: string;
  onWhite: number;
  onPorcelain: number;
}

function paletteSwatches(texts: DesignPageTexts): Swatch[] {
  const tokens = flattenTokens(tree);
  const white = tokenHex(tokens, "color.white");
  const porcelain = tokenHex(tokens, "color.porcelain");
  return [...tokens.values()]
    .filter((t) => t.path.startsWith("color.") && t.type === "color")
    .map((t) => {
      const hex = tokenHex(tokens, t.path);
      const [name = t.path, role = ""] = (t.description ?? t.path).split(/:\s*/, 2);
      const translated = texts.swatch(t.path);
      return {
        path: t.path,
        name: translated.name ?? name,
        role: translated.role ?? role,
        hex,
        cssVar: tokenCssVar(t.path),
        onWhite: checkContrast(hex, white),
        onPorcelain: checkContrast(hex, porcelain),
      };
    });
}

/** Allowed use derived from the computed ratio (never from a hardcoded table). */
function usage(ratio: number, texts: DesignPageTexts["usage"]) {
  if (ratio >= WCAG.text) return <Badge variant="success">{texts.text}</Badge>;
  if (ratio >= WCAG.nonText) return <Badge variant="warning">{texts.largeText}</Badge>;
  return <Badge variant="neutral">{texts.decorative}</Badge>;
}

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

function GuardTable({
  caption,
  rows,
  texts,
}: {
  caption: string;
  rows: ContrastResult[];
  texts: DesignPageTexts;
}) {
  const t = texts.brandGuard;
  return (
    <div className="overflow-x-auto rounded-lg border border-subtle bg-surface">
      <table className="w-full border-collapse text-left text-body-sm">
        <caption className="px-4 py-3 text-left text-label uppercase text-fg-muted">
          {caption}
        </caption>
        <thead>
          <tr className="border-y border-subtle">
            <th scope="col" className="px-4 py-2 font-medium">
              {t.pair}
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              {t.colors}
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              {t.contrast}
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              {t.minimum}
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              {t.result}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.theme}-${r.fg}-${r.bg}`}
              className="border-b border-subtle last:border-b-0"
            >
              <td className="px-4 py-2">{texts.pairLabel(r) ?? r.label}</td>
              <td className="px-4 py-2 font-mono text-mono-md">
                {r.fgHex} / {r.bgHex}
              </td>
              <td className="px-4 py-2" data-numeric>
                {texts.ratio(r.ratio)}
              </td>
              <td className="px-4 py-2" data-numeric>
                {texts.ratio(r.min)}
              </td>
              <td className="px-4 py-2">
                {r.pass ? (
                  <Badge variant="success">{t.passed}</Badge>
                ) : (
                  <Badge variant="error">{t.failed}</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComponentShowcase({ idPrefix, texts }: { idPrefix: string; texts: DesignPageTexts }) {
  const t = texts.showcase;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary">{t.approve}</Button>
        <Button variant="secondary">{t.compare}</Button>
        <Button variant="ghost">{t.undo}</Button>
        <Button variant="danger">{t.deleteDraft}</Button>
        <Button variant="secondary" size="icon" aria-label={t.export} title={t.export}>
          <Download aria-hidden="true" strokeWidth={1.5} />
        </Button>
        <Button variant="primary" disabled>
          {t.publishBlocked}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="neutral">{t.badge.draft}</Badge>
        <Badge variant="info" icon={Eye}>
          {t.badge.inReview}
        </Badge>
        <Badge variant="success">{t.badge.approved}</Badge>
        <Badge variant="warning">{t.badge.toCheck}</Badge>
        <Badge variant="error" icon={Lock}>
          {t.badge.blocked}
        </Badge>
        <Badge variant="error" icon={GitMerge}>
          {t.badge.conflict}
        </Badge>
        <Badge variant="highlight">{t.badge.new}</Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.form.title}</CardTitle>
            <CardDescription>{t.form.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${idPrefix}-name`}>{t.form.name}</Label>
              <Input id={`${idPrefix}-name`} placeholder={t.form.namePlaceholder} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${idPrefix}-site`}>{t.form.website}</Label>
              <Input
                id={`${idPrefix}-site`}
                type="url"
                aria-invalid="true"
                aria-describedby={`${idPrefix}-site-error`}
                defaultValue="rossi-arredamenti"
              />
              <p id={`${idPrefix}-site-error`} className="text-body-sm text-error">
                {t.form.websiteError}
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button variant="primary">{t.form.create}</Button>
            <Button variant="ghost">{t.form.cancel}</Button>
          </CardFooter>
        </Card>

        <AiProposal
          title={t.proposal.title}
          agent="brand-guard/contrast"
          sources={[
            {
              label: t.proposal.wcagSource,
              href: "https://www.w3.org/TR/WCAG22/#contrast-minimum",
            },
            { label: "tokens/forgecy.tokens.json" },
          ]}
          texts={texts.aiProposal}
        >
          {t.proposal.body}
        </AiProposal>
      </div>
    </div>
  );
}

export interface DesignPageProps {
  className?: string;
  texts: DesignPageTexts;
}

export function DesignPage({ className, texts }: DesignPageProps) {
  const swatches = paletteSwatches(texts);
  const guard = evaluateBrandGuard(tree);
  const failed = guard.filter((r) => !r.pass).length;

  return (
    <main className={cn("mx-auto flex max-w-6xl flex-col gap-12 px-6 py-12 text-fg", className)}>
      <header className="flex flex-col gap-4">
        <p className="text-label uppercase text-fg-muted">{texts.kicker}</p>
        <h1 className="font-display text-heading-xl">{texts.title}</h1>
        <p className="max-w-prose text-body-lg text-fg-muted">{texts.intro}</p>
        <div>
          {failed === 0 ? (
            <Badge variant="success">{texts.guardAllPass(guard.length)}</Badge>
          ) : (
            <Badge variant="error">{texts.guardSomeFail(failed)}</Badge>
          )}
        </div>
      </header>

      <Section id="design-colors" title={texts.colors.title} description={texts.colors.description}>
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
                  <dt className="text-fg-muted">{texts.colors.onWhite}</dt>
                  <dd data-numeric>{texts.ratio(s.onWhite)}</dd>
                  <dd>{usage(s.onWhite, texts.usage)}</dd>
                  <dt className="text-fg-muted">{texts.colors.onPorcelain}</dt>
                  <dd data-numeric>{texts.ratio(s.onPorcelain)}</dd>
                  <dd>{usage(s.onPorcelain, texts.usage)}</dd>
                </dl>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="design-brand-guard"
        title={texts.brandGuard.title}
        description={texts.brandGuard.description}
      >
        <GuardTable
          caption={texts.brandGuard.lightCaption}
          rows={guard.filter((r) => r.theme === "light")}
          texts={texts}
        />
        <GuardTable
          caption={texts.brandGuard.darkCaption}
          rows={guard.filter((r) => r.theme === "dark")}
          texts={texts}
        />
      </Section>

      <Section
        id="design-typography"
        title={texts.typography.title}
        description={texts.typography.description}
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
              <p className={t.className}>{texts.typography.samples[t.token]}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="design-components"
        title={texts.components.title}
        description={texts.components.description}
      >
        <ComponentShowcase idPrefix="design-light" texts={texts} />
      </Section>

      <Section
        id="design-dark-theme"
        title={texts.darkTheme.title}
        description={texts.darkTheme.description}
      >
        <div data-theme="dark" className="rounded-xl bg-app p-6 text-fg">
          <ComponentShowcase idPrefix="design-dark" texts={texts} />
        </div>
      </Section>
    </main>
  );
}
