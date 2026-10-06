/**
 * Client-facing Brand Book (UX spec 15.4): the pages of the agency's "Brand Book"
 * template built from an approved Brand Identity version. Pure: no database, no
 * rendering. Texts come from the version (the person's words) and the deliverable
 * labels of @forgecy/i18n in the book's language; nothing here is written by an AI,
 * and the book never carries prompts, scores or agent rules.
 *
 * Layouts are found by role, so another template with the same roles works too.
 */
import { referenceColors, type BrandIdentityDocument, type TokenTree } from "@forgecy/brand";
import type {
  BrandTheme,
  LayoutDef,
  SlideInput,
  SlideRole,
  TemplateManifest,
} from "@forgecy/carousel";
import type { Locale } from "@forgecy/core";
import { createFormat, getTranslator } from "@forgecy/i18n";
import { bookSections, type BookSection } from "./parts";

export interface BookInput {
  clientName: string;
  agencyName: string | null;
  versionNumber: number;
  /** Date printed on the book (the export date). */
  date: Date;
  language: Locale;
  document: BrandIdentityDocument;
  tokens: TokenTree;
  /** Colors the renderer applies: the palette page labels them. */
  colors: BrandTheme["colors"];
  /** Sections the person kept, in book order. */
  sections: readonly BookSection[];
}

type Values = Record<string, string | string[] | undefined | null | false>;
type Text = ReturnType<typeof getTranslator<"deliverable">>;

/** Cut to the slot limit at a word, with an ellipsis. `==` never reaches the slot. */
export function fitText(text: string | null | undefined, max: number): string {
  const clean = (text ?? "").replace(/==/g, "=").replace(/\s+/g, " ").trim();
  const chars = [...clean];
  if (chars.length <= max) return clean;
  const cut = chars.slice(0, max - 1).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, "")}…`;
}

function fill(layout: LayoutDef, values: Values): SlideInput {
  const slots: Record<string, string | string[]> = {};
  for (const def of layout.slots) {
    const v = values[def.name];
    if (def.type === "text" && typeof v === "string") {
      const text = fitText(v, def.maxChars);
      if (text) slots[def.name] = text;
    } else if (def.type === "list" && Array.isArray(v)) {
      const items = v
        .map((x) => fitText(x, def.maxChars))
        .filter(Boolean)
        .slice(0, def.maxItems);
      if (items.length) slots[def.name] = items;
    }
  }
  return { layout: layout.id, slots };
}

const live = <T extends { deprecated?: boolean | undefined }>(items: readonly T[]) =>
  items.filter((i) => !i.deprecated);
const joined = (a: string, b: string | undefined | null) => (b ? `${a} · ${b}` : a);

const channelNames: Record<string, string> = {
  instagram: "Instagram",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  tiktok: "TikTok",
};

type Page = { role: SlideRole; values: Values };

function writingRules(d: BrandIdentityDocument, t: Text): string[] {
  const w = d.verbal.writingRules?.deprecated ? undefined : d.verbal.writingRules?.value;
  if (!w) return [];
  const out: string[] = [];
  for (const key of ["person", "emoji", "anglicisms", "exclamations"] as const) {
    const value = w[key];
    if (value) out.push(t(`brandBook.writing.${key}`, { value }));
  }
  for (const key of ["maxSentenceWords", "maxHashtags"] as const) {
    const value = w[key];
    if (value !== undefined) out.push(t(`brandBook.writing.${key}`, { value }));
  }
  for (const key of [
    "capitalization",
    "numbers",
    "ctaStyle",
    "headlineStyle",
    "captionStyle",
    "notes",
  ] as const) {
    const value = w[key];
    if (value) out.push(t(`brandBook.writing.${key}`, { value }));
  }
  return out;
}

/** Pages of one section (without its opener); empty when the version has nothing for it. */
function sectionPages(section: BookSection, input: Omit<BookInput, "sections">, t: Text): Page[] {
  const d = input.document;
  const label = t(`brandBook.sections.${section}.title`);
  const pages: Page[] = [];
  const list = (title: string, items: string[], intro?: string) => {
    if (items.length) pages.push({ role: "list", values: { label, title, intro, items } });
  };
  const compare = (title: string, left: [string, string[]], right: [string, string[]]) => {
    if (left[1].length || right[1].length)
      pages.push({
        role: "comparison",
        values: {
          label,
          title,
          left_label: left[0],
          left: left[1],
          right_label: right[0],
          right: right[1],
        },
      });
  };

  switch (section) {
    case "strategy": {
      const s = d.strategy;
      const statement = s.oneLiner?.value ?? s.positioning?.value;
      if (statement)
        pages.push({
          role: "text",
          values: {
            label: t("brandBook.pages.positioning"),
            statement,
            body: s.oneLiner ? s.positioning?.value : s.differentiation?.value,
          },
        });
      if (s.promise)
        pages.push({
          role: "text",
          values: {
            label: t("brandBook.pages.promise"),
            statement: s.promise.value,
            body: s.oneLiner ? s.differentiation?.value : undefined,
          },
        });
      const first = s.mission ?? s.vision;
      if (first)
        pages.push({
          role: "text",
          values: {
            label: t("brandBook.pages.missionVision"),
            statement: first.value,
            body: s.mission ? s.vision?.value : undefined,
          },
        });
      list(
        t("brandBook.pages.values"),
        live(s.values).map((v) => joined(v.value.name, v.value.description)),
      );
      list(
        t("brandBook.pages.audience"),
        live(s.audience).map((a) =>
          joined(
            a.value.role ? `${a.value.name} (${a.value.role})` : a.value.name,
            a.value.problems ?? a.value.goals,
          ),
        ),
      );
      list(
        t("brandBook.pages.messages"),
        live(s.messages)
          .filter((m) => m.value.kind !== "objection" && m.value.kind !== "cta")
          .map((m) => m.value.text),
      );
      break;
    }
    case "verbal": {
      const v = d.verbal;
      if (v.voice)
        pages.push({
          role: "text",
          values: { label: t("brandBook.pages.voice"), statement: v.voice.value },
        });
      list(
        t("brandBook.pages.tone"),
        live(v.toneAxes).map((a) =>
          joined(
            t("brandBook.tone", {
              left: t(`brandBook.axes.${a.value.axis}.left`),
              right: t(`brandBook.axes.${a.value.axis}.right`),
              value: a.value.value,
            }),
            `“${a.value.goodExample}”`,
          ),
        ),
      );
      const weAre = live(v.weAreWeAreNot);
      compare(
        t("brandBook.pages.weAre"),
        [t("brandBook.pages.weAreLabel"), weAre.map((w) => w.value.weAre)],
        [t("brandBook.pages.weAreNotLabel"), weAre.map((w) => w.value.weAreNot)],
      );
      list(t("brandBook.pages.writing"), writingRules(d, t));
      compare(
        t("brandBook.pages.words"),
        [t("brandBook.pages.preferredWords"), v.preferredWords],
        [t("brandBook.pages.forbiddenWords"), v.forbiddenWords],
      );
      break;
    }
    case "visual": {
      const v = d.visual;
      const rules = [
        v.logo.clearSpace && t("brandBook.logoRules.clearSpace", { value: v.logo.clearSpace }),
        v.logo.minSizePx !== undefined &&
          t("brandBook.logoRules.minSize", { value: String(v.logo.minSizePx) }),
        v.logo.allowedBackgrounds &&
          t("brandBook.logoRules.backgrounds", { value: v.logo.allowedBackgrounds }),
      ].filter((x): x is string => !!x);
      if (v.logo.variants.length || rules.length || v.logo.forbiddenUses.length)
        pages.push({
          role: "logo",
          values: {
            label,
            title: t("brandBook.pages.logo"),
            rules,
            forbidden: v.logo.forbiddenUses,
          },
        });
      const palette = referenceColors(input.tokens);
      const roles = [
        ["swatch_background", "background", "background"],
        ["swatch_surface", "surface", "surface"],
        ["swatch_text", "text", "text.primary"],
        ["swatch_accent", "accent", "accent"],
        ["swatch_cta", "cta", "cta.bg"],
      ] as const;
      const swatches: Values = {};
      for (const [slot, name, role] of roles) {
        const hex = input.colors[role];
        if (hex) swatches[slot] = `${t(`brandBook.roles.${name}`)} · ${hex.toUpperCase()}`;
      }
      if (palette.length || Object.keys(swatches).length)
        pages.push({
          role: "palette",
          values: {
            label,
            title: t("brandBook.pages.colors"),
            intro: t("brandBook.pages.colorsIntro"),
            ...swatches,
            colors: palette.map((c) => `${c.name} · ${c.hex.toUpperCase()}`),
          },
        });
      const type = live(v.typography).map((x) => x.value);
      const heading = type.find((x) => x.role === "display") ?? type[0];
      const body = type.find((x) => x.role === "body" && x !== heading);
      const detail = (x: (typeof type)[number]) =>
        [
          t(`brandBook.typeRoles.${x.role}`),
          x.weights.length ? t("brandBook.weights", { weights: x.weights.join(", ") }) : null,
          x.fallback ? t("brandBook.fallback", { font: x.fallback }) : null,
        ]
          .filter(Boolean)
          .join(" · ");
      if (heading)
        pages.push({
          role: "typography",
          values: {
            label,
            title: t("brandBook.pages.typography"),
            heading_family: heading.family,
            heading_detail: detail(heading),
            body_family: body?.family,
            body_detail: body ? detail(body) : undefined,
            sample_heading: d.strategy.oneLiner?.value,
            sample_body: d.strategy.promise?.value ?? d.strategy.positioning?.value,
          },
        });
      const img = v.imagery?.deprecated ? undefined : v.imagery?.value;
      if (img) {
        const items: string[] = [];
        for (const key of ["subjects", "settings", "framing", "lighting", "colorMood"] as const)
          if (img[key].length)
            items.push(t(`brandBook.imagery.${key}`, { value: img[key].join(", ") }));
        if (img.people) items.push(t("brandBook.imagery.people", { value: img.people }));
        if (img.illustration)
          items.push(t("brandBook.imagery.illustration", { value: img.illustration }));
        if (img.forbidden.length)
          items.push(t("brandBook.imagery.forbidden", { value: img.forbidden.join(", ") }));
        list(t("brandBook.pages.imagery"), items);
      }
      break;
    }
    case "content":
      list(
        t("brandBook.pages.pillars"),
        live(d.content.pillars).map((p) => joined(p.value.name, p.value.goal)),
      );
      list(
        t("brandBook.pages.channels"),
        live(d.channels).map((c) =>
          joined(
            channelNames[c.value.channel] ?? c.value.channel,
            c.value.goal ?? c.value.toneShift,
          ),
        ),
      );
      break;
    case "dos":
      compare(
        t("brandBook.pages.dos"),
        [t("brandBook.pages.doLabel"), d.visual.do],
        [
          t("brandBook.pages.dontLabel"),
          [...d.visual.dont, ...live(d.strategy.avoidTopics).map((a) => a.value)],
        ],
      );
      break;
  }
  return pages;
}

/** Sections the version has nothing for: the person completes them or leaves them out. */
export function emptyBookSections(input: Omit<BookInput, "sections">): BookSection[] {
  const t = getTranslator(input.language, "deliverable");
  return bookSections.filter((s) => sectionPages(s, input, t).length === 0);
}

export interface BookSlides {
  slides: SlideInput[];
  /** Pages left out to stay within the template's page limit. */
  dropped: number;
}

export function bookSlides(input: BookInput, template: TemplateManifest): BookSlides {
  const t = getTranslator(input.language, "deliverable");
  const byRole = (role: SlideRole) => {
    const layout = template.layouts.find((l) => l.role === role);
    if (!layout) throw new Error(`The template has no “${role}” page`);
    return layout;
  };
  const date = createFormat(input.language, "UTC").date(input.date, "month");
  const version = t("brandBook.version", { number: input.versionNumber });
  const footer = input.agencyName
    ? t("brandBook.footer", { agency: input.agencyName, number: input.versionNumber, date })
    : t("brandBook.footerNoAgency", { number: input.versionNumber, date });

  const blocks = bookSections
    .filter((s) => input.sections.includes(s))
    .map((s) => ({ section: s, pages: sectionPages(s, input, t) }))
    .filter((b) => b.pages.length);

  const head: SlideInput[] = [
    fill(byRole("cover"), {
      kicker: t("brandBook.kicker"),
      title: input.clientName,
      subtitle: input.document.strategy.oneLiner?.value,
      version,
      date,
      prepared_by: input.agencyName,
    }),
    fill(byRole("contents"), {
      title: t("brandBook.contents"),
      items: blocks.map((b) => t(`brandBook.sections.${b.section}.title`)),
      footer,
    }),
  ];
  const tail: SlideInput[] = input.agencyName
    ? [
        fill(byRole("signature"), {
          title: t("brandBook.signatureTitle"),
          agency: input.agencyName,
          version,
          date,
          note: t("brandBook.signatureNote", { number: input.versionNumber }),
        }),
      ]
    : [];
  const body = blocks.map((b, i) => ({
    opener: fill(byRole("section"), {
      number: String(i + 1).padStart(2, "0"),
      title: t(`brandBook.sections.${b.section}.title`),
      intro: t(`brandBook.sections.${b.section}.intro`),
      footer,
    }),
    pages: b.pages.map((p) => fill(byRole(p.role), { ...p.values, footer })),
  }));

  // Stay within the template's page limit: drop pages from the longest sections.
  const max = template.slides.max;
  const count = () => head.length + tail.length + body.reduce((n, b) => n + 1 + b.pages.length, 0);
  let dropped = 0;
  while (count() > max) {
    const longest = body.reduce((a, b) => (b.pages.length > a.pages.length ? b : a));
    if (!longest.pages.length) break;
    longest.pages.pop();
    dropped++;
  }
  return {
    slides: [...head, ...body.flatMap((b) => [b.opener, ...b.pages]), ...tail],
    dropped,
  };
}
