import type { LayoutDef, SlideInput, SlideRole, TemplateManifest } from "@forgecy/carousel";
import type { Level } from "@forgecy/core";
import type { ReportDocItem, ReportDocSection, ReportDocument } from "../service/reports";
import { fitText } from "./text";

const TEXT = {
  it: {
    kicker: "Audit di comunicazione",
    title: (name: string) => `La comunicazione di ==${name}==`,
    subtitle: "Sito, social e competitor: cosa funziona, cosa no e da dove partire.",
    problem: (n: number) => `Problema ${n}`,
    finding: (section: string, n: number) => `${section} · ${n}`,
    priority: { high: "Priorità alta", medium: "Priorità media", low: "Priorità bassa" },
    noEvidence: "Osservazione dell'agenzia",
    fromCauses: "Nasce dalle osservazioni elencate qui sotto.",
    noRecommendation: "Da approfondire insieme nella call di restituzione.",
    noSteps: "Fissiamo una call per decidere insieme le priorità.",
    months: [
      "gennaio",
      "febbraio",
      "marzo",
      "aprile",
      "maggio",
      "giugno",
      "luglio",
      "agosto",
      "settembre",
      "ottobre",
      "novembre",
      "dicembre",
    ],
  },
  en: {
    kicker: "Communication audit",
    title: (name: string) => `How ==${name}== communicates`,
    subtitle: "Website, social media and competitors: what works, what does not, where to start.",
    problem: (n: number) => `Problem ${n}`,
    finding: (section: string, n: number) => `${section} · ${n}`,
    priority: { high: "High priority", medium: "Medium priority", low: "Low priority" },
    noEvidence: "Agency observation",
    fromCauses: "It comes from the observations listed below.",
    noRecommendation: "To be discussed together in the follow-up call.",
    noSteps: "Let's schedule a call to agree on the priorities.",
    months: [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ],
  },
} as const;

type Text = (typeof TEXT)["it" | "en"];
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
 * Pages of the «Report di audit» template from a report document: a cover, an opener
 * per section with its findings or problems one per page, next steps and method.
 * Texts are cut to the template limits; layouts are found by role, so another
 * report template with the same roles works too.
 */
export function reportSlides(doc: ReportDocument, template: TemplateManifest): ReportSlides {
  const t = TEXT[doc.language];
  const byRole = (role: SlideRole) => {
    const layout = template.layouts.find((l) => l.role === role);
    if (!layout) throw new Error(`Il template non ha una pagina «${role}»`);
    return layout;
  };
  const cover = byRole("cover");
  const section = byRole("section");
  const finding = byRole("finding");
  const problem = byRole("problem");
  const nextSteps = byRole("next_steps");
  const method = byRole("method");

  const [year, month] = doc.date.split("-").map(Number);
  const date = year && month ? `${t.months[month - 1]} ${year}` : doc.date;
  const coverSection = doc.sections.find((s) => s.key === "cover");
  const head: SlideInput[] = [
    fitSlot(
      cover,
      {
        kicker: t.kicker,
        title: t.title(fitText(doc.prospect.name, 40)),
        subtitle: coverSection?.intro || t.subtitle,
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
            steps: s.bullets.length ? s.bullets : [t.noSteps],
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
    label: t.problem(i + 1),
    title: item.title,
    description:
      item.description ||
      item.recommendation ||
      (item.causes.length ? t.fromCauses : t.noRecommendation),
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
    label: t.finding(s.title, i + 1),
    severity: t.priority[item.priority as Level],
    title: item.title,
    description: item.description || item.impact || item.title,
    evidence: item.evidence.length ? item.evidence.join(" · ") : t.noEvidence,
    recommendation: item.recommendation || item.impact || t.noRecommendation,
  });
}
