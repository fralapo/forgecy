import { type ContrastPair, DesignPage, type DesignPageTexts } from "@forgecy/ui";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getFormat } from "@/lib/i18n";
import { requireUser } from "@/lib/session";

export async function generateMetadata() {
  const t = await getTranslations("design");
  return { title: t("title") };
}

/** Color tokens whose role (light palette) or name (dark palette) has a translation. */
const SWATCH_ROLE = {
  "color.forge-blue": "forgeBlue",
  "color.forge-blue-700": "forgeBlue700",
  "color.porcelain": "porcelain",
  "color.white": "white",
  "color.graphite-900": "graphite900",
  "color.graphite-70": "graphite70",
  "color.graphite-50": "graphite50",
  "color.gray-grid": "grayGrid",
  "color.amber": "amber",
  "color.green": "green",
  "color.green-700": "green700",
  "color.orange": "orange",
  "color.orange-700": "orange700",
  "color.red": "red",
  "color.red-700": "red700",
} as const;
const DARK_NAME = {
  "color.dark.graphite-800": "graphite800",
  "color.dark.graphite-700": "graphite700",
  "color.dark.graphite-30": "graphite30",
  "color.dark.blue-300": "blue300",
  "color.dark.green-300": "green300",
  "color.dark.orange-300": "orange300",
  "color.dark.red-300": "red300",
} as const;

/** Brand Guard pairs: the foreground on the app background or a surface... */
const PAIR_SUBJECT = {
  "text.primary": "primaryText",
  "text.secondary": "secondaryText",
  "text.link": "link",
  "status.success.text": "successText",
  "status.warning.text": "warningText",
  "status.error.text": "errorText",
  "border.control": "controlBorder",
  "focus.ring": "focusRing",
} as const;
/** ...or a named component pair. */
const PAIR_SPECIAL = {
  "action.primary.text|action.primary.bg": "primaryButton",
  "action.primary.text|action.primary.bg-pressed": "primaryButtonPressed",
  "action.danger.text|action.danger.bg": "destructiveButton",
  "accent.on-highlight|accent.highlight": "textOnHighlight",
} as const;

// Technical sample of the mono scale: a job id and a skill path, the same in every language.
const MONO_SAMPLE = "job_7f3a2c · skills/brand-audit";
const AGENT = "brand-guard/contrast";
// The sample date shown in the body-sm line.
const SAMPLE_EDIT = new Date(2026, 9, 5, 14, 32);

const has = <T extends object>(map: T, key: string): key is Extract<keyof T, string> =>
  Object.hasOwn(map, key);

/** Internal Brand Guard page: palette, contrasts, type scale and components. */
export default async function DesignRoute() {
  await requireUser();
  const t = await getTranslations("design");
  const format = await getFormat();
  const ratio = (value: number) =>
    t("ratio", {
      value: format.number(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    });
  const code = (chunks: ReactNode) => (
    <code className="font-mono text-mono-md text-fg">{chunks}</code>
  );

  const pairLabel = (pair: ContrastPair) => {
    const special = `${pair.fg}|${pair.bg}`;
    if (has(PAIR_SPECIAL, special)) return t(`brandGuard.special.${PAIR_SPECIAL[special]}`);
    if (has(PAIR_SUBJECT, pair.fg) && (pair.bg === "bg.app" || pair.bg === "bg.surface"))
      return t("brandGuard.onSurface", {
        subject: t(`brandGuard.subject.${PAIR_SUBJECT[pair.fg]}`),
        surface: pair.bg === "bg.app" ? "app" : "surface",
      });
    return undefined;
  };

  const texts: DesignPageTexts = {
    kicker: t("kicker"),
    title: t("title"),
    intro: t.rich("intro", { code }),
    guardAllPass: (count) => t("guard.allPass", { count }),
    guardSomeFail: (count) => t("guard.someFail", { count }),
    ratio,
    usage: {
      text: t("usage.text"),
      largeText: t("usage.largeText"),
      decorative: t("usage.decorative"),
    },
    colors: {
      title: t("colors.title"),
      description: t("colors.description"),
      onWhite: t("colors.onWhite"),
      onPorcelain: t("colors.onPorcelain"),
    },
    swatch: (path) => {
      if (has(SWATCH_ROLE, path)) return { role: t(`colors.role.${SWATCH_ROLE[path]}`) };
      if (has(DARK_NAME, path)) return { name: t(`colors.darkName.${DARK_NAME[path]}`) };
      return {};
    },
    brandGuard: {
      title: t("brandGuard.title"),
      description: t("brandGuard.description"),
      lightCaption: t("brandGuard.lightCaption"),
      darkCaption: t("brandGuard.darkCaption"),
      pair: t("brandGuard.pair"),
      colors: t("brandGuard.colors"),
      contrast: t("brandGuard.contrast"),
      minimum: t("brandGuard.minimum"),
      result: t("brandGuard.result"),
      passed: t("brandGuard.passed"),
      failed: t("brandGuard.failed"),
    },
    pairLabel,
    typography: {
      title: t("typography.title"),
      description: t("typography.description"),
      samples: {
        "heading-xl": t("typography.sample.headingXl"),
        "heading-lg": t("typography.sample.headingLg"),
        "heading-md": t("typography.sample.headingMd"),
        "heading-sm": t("typography.sample.headingSm"),
        "body-lg": t("typography.sample.bodyLg"),
        "body-md": t("typography.sample.bodyMd"),
        "body-sm": t("typography.sample.bodySm", {
          date: format.date(SAMPLE_EDIT, "long"),
          time: format.date(SAMPLE_EDIT, "time"),
        }),
        label: t("typography.sample.label"),
        "mono-md": MONO_SAMPLE,
      },
    },
    components: { title: t("components.title"), description: t("components.description") },
    darkTheme: { title: t("darkTheme.title"), description: t("darkTheme.description") },
    showcase: {
      approve: t("showcase.approve"),
      compare: t("showcase.compare"),
      undo: t("showcase.undo"),
      deleteDraft: t("showcase.deleteDraft"),
      export: t("showcase.export"),
      publishBlocked: t("showcase.publishBlocked"),
      badge: {
        draft: t("showcase.badge.draft"),
        inReview: t("showcase.badge.inReview"),
        approved: t("showcase.badge.approved"),
        toCheck: t("showcase.badge.toCheck"),
        blocked: t("showcase.badge.blocked"),
        conflict: t("showcase.badge.conflict"),
        new: t("showcase.badge.new"),
      },
      form: {
        title: t("showcase.form.title"),
        description: t("showcase.form.description"),
        name: t("showcase.form.name"),
        namePlaceholder: t("showcase.form.namePlaceholder"),
        website: t("showcase.form.website"),
        websiteError: t("showcase.form.websiteError"),
        create: t("showcase.form.create"),
        cancel: t("showcase.form.cancel"),
      },
      proposal: {
        title: t("showcase.proposal.title"),
        body: t("showcase.proposal.body", { ratio: ratio(4.8) }),
        wcagSource: t("showcase.proposal.wcagSource"),
      },
    },
    aiProposal: {
      kicker: t("aiProposal.kicker"),
      byline: t.rich("aiProposal.byline", { agent: AGENT, code }),
      sources: t("aiProposal.sources"),
      noSources: t("aiProposal.noSources"),
      accept: t("aiProposal.accept"),
      reject: t("aiProposal.reject"),
    },
  };

  return <DesignPage texts={texts} />;
}
