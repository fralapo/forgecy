import type { LayoutDef, SlideInput, SlideRole, TemplateManifest } from "@forgecy/carousel";
import type { Level, Locale } from "@forgecy/core";
import { createFormat, getTranslator } from "@forgecy/i18n";
import type { ReportDocItem, ReportDocSection, ReportDocument } from "../service/reports";
import { fitText } from "./text";

/** Texts of the client deliverable, in the report's language (packages/i18n, `deliverable`). */
type Text = ReturnType<typeof deliverableText>;

function deliverableText(language: Locale) {
  return getTranslator(language, "deliverable");
}

type Values = Record<string, string | string[] | undefined>;

/** Fit values to the limits the template declares; empty values are left out. */
function fitSlot(layout: LayoutDef, values: Values, highlighted: string[] = []): SlideInput {
  const slots: Record<string, string | string[]> = {};
  for (const def of layout.slots) {
    const v = values[def.name];
    if (def.type === "text" && typeof v === "string") {
      // Only the builder's own highlight (already sized) keeps its markers.
      const text = highlighted.includes(def.name) ? v : fitText(v, def.maxChars);
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

export interface ReportSlides {
  slides: SlideInput[];
  /** Findings left out to stay within the template's page limit. */
  dropped: number;
}

/**
 * Pages of the “Audit report” template from a report document: a cover, an opener
 * per section with its findings or problems one per page, next steps and method.
 * Texts are cut to the template limits; layouts are found by role, so another
 * report template with the same roles works too.
 */
export function reportSlides(doc: ReportDocument, template: TemplateManifest): ReportSlides {
  const t = deliverableText(doc.language);
  const byRole = (role: SlideRole) => {
    const layout = template.layouts.find((l) => l.role === role);
    if (!layout) throw new Error(`The template has no “${role}” page`);
    return layout;
  };
  const cover = byRole("cover");
  const section = byRole("section");
  const finding = byRole("finding");
  const problem = byRole("problem");
  const nextSteps = byRole("next_steps");
  const method = byRole("method");

  const [year, month] = doc.date.split("-").map(Number);
  const date =
    year && month
      ? createFormat(doc.language, "UTC").date(Date.UTC(year, month - 1, 15), "month")
      : doc.date;
  const coverSection = doc.sections.find((s) => s.key === "cover");
  const head: SlideInput[] = [
    fitSlot(
      cover,
      {
        kicker: t("auditReport.kicker"),
        title: t("auditReport.title", { name: fitText(doc.prospect.name, 40) }),
        subtitle: coverSection?.intro || t("auditReport.subtitle"),
        client: doc.prospect.name,
        date,
        prepared_by: doc.agency.name ?? undefined,
      },
      ["title"],
    ),
  ];

  // Each section: an opener and, for sections with findings, one page per item.
  let number = 0;
  const blocks: Array<{ opener: SlideInput[]; pages: SlideInput[] }> = [];
  for (const s of doc.sections) {
    if (s.key === "cover") continue;
    if (s.key === "method") {
      blocks.push({
        opener: [
          fitSlot(method, { title: s.title, intro: s.intro, items: s.bullets, note: s.note }),
        ],
        pages: [],
      });
      continue;
    }
    if (s.key === "next_steps") {
      blocks.push({
        opener: [
          fitSlot(nextSteps, {
            title: s.title,
            intro: s.intro,
            steps: s.bullets.length ? s.bullets : [t("auditReport.noSteps")],
          }),
        ],
        pages: [],
      });
      continue;
    }
    number++;
    blocks.push({
      opener: [
        fitSlot(section, {
          number: String(number).padStart(2, "0"),
          title: s.title,
          intro: s.intro,
          items: s.key === "overview" ? s.bullets : s.items.map((i) => i.title),
        }),
      ],
      pages: s.items.map((item, i) =>
        s.key === "problems"
          ? problemPage(problem, item, i, t)
          : findingPage(finding, s, item, i, t),
      ),
    });
  }

  // Stay within the template's page limit: drop findings from the longest sections.
  const max = template.slides.max;
  const count = () =>
    head.length + blocks.reduce((n, b) => n + b.opener.length + b.pages.length, 0);
  let dropped = 0;
  while (count() > max) {
    const longest = blocks.reduce((a, b) => (b.pages.length > a.pages.length ? b : a));
    if (!longest.pages.length) break;
    longest.pages.pop();
    dropped++;
  }
  return { slides: [...head, ...blocks.flatMap((b) => [...b.opener, ...b.pages])], dropped };
}

function problemPage(layout: LayoutDef, item: ReportDocItem, i: number, t: Text): SlideInput {
  return fitSlot(layout, {
    label: t("auditReport.problem", { number: i + 1 }),
    title: item.title,
    description:
      item.description ||
      item.recommendation ||
      t(item.causes.length ? "auditReport.fromCauses" : "auditReport.noRecommendation"),
    impact: item.impact ?? undefined,
    causes: item.causes,
  });
}

function findingPage(
  layout: LayoutDef,
  s: ReportDocSection,
  item: ReportDocItem,
  i: number,
  t: Text,
): SlideInput {
  return fitSlot(layout, {
    label: t("auditReport.finding", { section: s.title, number: i + 1 }),
    severity: t(`auditReport.priority.${item.priority as Level}`),
    title: item.title,
    description: item.description || item.impact || item.title,
    evidence: item.evidence.length ? item.evidence.join(" · ") : t("auditReport.noEvidence"),
    recommendation: item.recommendation || item.impact || t("auditReport.noRecommendation"),
  });
}
