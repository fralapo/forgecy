/**
 * What the block pages show for each field of a section. The values follow the
 * document schema of @forgecy/brand; the server validates them again on save.
 */
import {
  awarenessLevels,
  channelKeys,
  funnelStages,
  logoRoles,
  messageKinds,
  toneAxes,
  typographyRoles,
  type DocumentSectionKey,
} from "@forgecy/brand/client";

export type Option = { value: string; label: string };
const opts = (values: readonly string[], labels: Record<string, string> = {}): Option[] =>
  values.map((v) => ({ value: v, label: labels[v] ?? v }));

export type Ctl =
  | { kind: "text"; key: string; label: string; hint?: string }
  | { kind: "textarea"; key: string; label: string; hint?: string; maxWords?: number }
  | { kind: "number"; key: string; label: string; min?: number; max?: number }
  | { kind: "select"; key: string; label: string; options: Option[]; required?: boolean }
  | { kind: "scale"; key: string; label: string; min: number; max: number }
  | { kind: "lines"; key: string; label: string; hint?: string }
  | { kind: "numbers"; key: string; label: string; hint?: string }
  | { kind: "list"; key: string; label: string; item: Ctl[]; withId?: boolean; addLabel: string }
  | { kind: "source"; key: string; label: string };

export type FieldUi =
  | {
      kind: "sourced";
      key: string;
      label: string;
      multiline?: boolean;
      hint?: string;
      maxWords?: number;
    }
  | { kind: "sourced-object"; key: string; label: string; item: Ctl[] }
  | {
      kind: "sourced-list";
      key: string;
      label: string;
      item: Ctl[] | "text";
      addLabel: string;
      hint?: string;
    }
  | { kind: "lines"; key: string; label: string; hint?: string }
  | { kind: "object"; key: string; label: string; item: Ctl[] }
  | { kind: "list"; key: string; label: string; item: Ctl[]; withId?: boolean; addLabel: string };

export interface SectionUi {
  section: DocumentSectionKey;
  title: string;
  /** "list" when the section itself is an array (channels). */
  root?: "list";
  fields: FieldUi[];
}

const awarenessLabels: Record<string, string> = {
  unaware: "Unaware",
  problem_aware: "Problem aware",
  solution_aware: "Solution aware",
  product_aware: "Product aware",
  most_aware: "Ready to buy",
};
const messageLabels: Record<string, string> = {
  value_proposition: "Value proposition",
  tagline: "Tagline",
  claim: "Claim",
  proof_point: "Proof point",
  reason_to_believe: "Reason to believe",
  elevator_pitch: "Elevator pitch",
  objection: "Objection",
  cta: "CTA",
};
const logoLabels: Record<string, string> = {
  logo_primary: "Primary logo",
  logo_secondary: "Secondary logo",
  symbol: "Symbol",
  wordmark: "Wordmark",
  logo_mono: "Monochrome",
  logo_negative: "Negative",
  favicon: "Favicon",
};
const typoLabels: Record<string, string> = { display: "Headings", body: "Body text", data: "Data" };
const funnelLabels: Record<string, string> = {
  awareness: "Awareness",
  consideration: "Consideration",
  conversion: "Conversion",
  loyalty: "Loyalty",
};
// Values are the Italian grammatical persons stored in the document; labels explain them.
const personLabels: Record<string, string> = {
  tu: "Informal “you” (tu)",
  lei: "Formal “you” (Lei)",
  voi: "Plural “you” (voi)",
  noi: "We (noi)",
  impersonale: "Impersonal",
};
const triple = (a: string, b: string, c: string) => [
  { value: "no", label: a },
  { value: "limited", label: b },
  { value: "yes", label: c },
];

export const strategyUi: SectionUi = {
  section: "strategy",
  title: "Strategy",
  fields: [
    {
      kind: "sourced",
      key: "oneLiner",
      label: "One-liner",
      hint: "Who you are and why you matter, in under 20 words.",
      maxWords: 20,
    },
    { kind: "sourced", key: "insight", label: "Insight", multiline: true },
    { kind: "sourced", key: "positioning", label: "Positioning", multiline: true },
    { kind: "sourced", key: "promise", label: "Promise", multiline: true },
    { kind: "sourced", key: "differentiation", label: "Differentiation", multiline: true },
    { kind: "sourced", key: "mission", label: "Mission", multiline: true },
    { kind: "sourced", key: "vision", label: "Vision", multiline: true },
    { kind: "sourced", key: "category", label: "Category" },
    {
      kind: "sourced-list",
      key: "values",
      label: "Values",
      addLabel: "Add value",
      item: [
        { kind: "text", key: "name", label: "Name" },
        { kind: "textarea", key: "description", label: "What it means" },
      ],
    },
    {
      kind: "sourced-list",
      key: "audience",
      label: "Audience",
      addLabel: "Add segment",
      item: [
        { kind: "text", key: "name", label: "Segment" },
        { kind: "text", key: "role", label: "Role" },
        { kind: "text", key: "sector", label: "Industry" },
        {
          kind: "select",
          key: "awareness",
          label: "Awareness",
          options: opts(awarenessLevels, awarenessLabels),
        },
        { kind: "textarea", key: "goals", label: "Goals" },
        { kind: "textarea", key: "problems", label: "Problems" },
        { kind: "textarea", key: "fears", label: "Fears" },
        { kind: "textarea", key: "objections", label: "Objections" },
        { kind: "textarea", key: "triggers", label: "Purchase triggers" },
        { kind: "textarea", key: "language", label: "Language" },
        { kind: "text", key: "channels", label: "Channels" },
        { kind: "textarea", key: "alternatives", label: "Alternatives" },
      ],
    },
    {
      kind: "sourced-list",
      key: "messages",
      label: "Messages and claims",
      addLabel: "Add message",
      hint: "Every claim needs proof: without it, it must be confirmed before publishing.",
      item: [
        {
          kind: "select",
          key: "kind",
          label: "Type",
          options: opts(messageKinds, messageLabels),
          required: true,
        },
        { kind: "textarea", key: "text", label: "Text" },
        { kind: "textarea", key: "proof", label: "Proof or source" },
        { kind: "textarea", key: "answer", label: "Answer (for objections)" },
      ],
    },
    {
      kind: "sourced-list",
      key: "avoidTopics",
      label: "Topics to avoid",
      addLabel: "Add topic",
      item: "text",
    },
  ],
};

export const competitorsUi: SectionUi = {
  section: "competitors",
  title: "Competitors",
  fields: [
    {
      kind: "sourced-list",
      key: "list",
      label: "Competitors",
      addLabel: "Add competitor",
      item: [
        { kind: "text", key: "name", label: "Name" },
        {
          kind: "select",
          key: "kind",
          label: "Type",
          options: [
            { value: "direct", label: "Direct" },
            { value: "indirect", label: "Indirect" },
            { value: "alternative", label: "Alternative" },
          ],
          required: true,
        },
        { kind: "text", key: "url", label: "Website" },
        { kind: "textarea", key: "notes", label: "Notes" },
      ],
    },
    { kind: "lines", key: "overusedMessages", label: "Overused messages in the industry" },
    { kind: "lines", key: "commonVisualCodes", label: "Common visual codes" },
    { kind: "lines", key: "openSpaces", label: "Open spaces" },
  ],
};

export const verbalUi: SectionUi = {
  section: "verbal",
  title: "Verbal",
  fields: [
    {
      kind: "sourced",
      key: "voice",
      label: "Voice",
      multiline: true,
      hint: "Consistent across every channel.",
    },
    {
      kind: "sourced-list",
      key: "toneAxes",
      label: "Tone axes",
      addLabel: "Add axis",
      hint: "An adjective without examples is not enough: you need one right and one wrong sentence.",
      item: [
        {
          kind: "select",
          key: "axis",
          label: "Axis",
          options: toneAxes.map((a) => ({ value: a.key, label: `${a.left} / ${a.right}` })),
          required: true,
        },
        {
          kind: "scale",
          key: "value",
          label: "Position (1 = left, 5 = right)",
          min: 1,
          max: 5,
        },
        { kind: "textarea", key: "goodExample", label: "Right sentence" },
        { kind: "textarea", key: "badExample", label: "Wrong sentence" },
      ],
    },
    {
      kind: "sourced-list",
      key: "weAreWeAreNot",
      label: "We are / We are not",
      addLabel: "Add row",
      item: [
        { kind: "text", key: "weAre", label: "We are" },
        { kind: "text", key: "weAreNot", label: "We are not" },
      ],
    },
    {
      kind: "sourced-object",
      key: "writingRules",
      label: "Writing rules",
      item: [
        {
          kind: "select",
          key: "person",
          label: "Grammatical person",
          options: opts(["tu", "lei", "voi", "noi", "impersonale"], personLabels),
        },
        {
          kind: "select",
          key: "emoji",
          label: "Emoji",
          options: triple("Never", "In moderation", "Allowed"),
        },
        {
          kind: "number",
          key: "maxSentenceWords",
          label: "Max words per sentence",
          min: 3,
          max: 80,
        },
        { kind: "number", key: "maxHashtags", label: "Max hashtags", min: 0, max: 30 },
        {
          kind: "select",
          key: "anglicisms",
          label: "Anglicisms",
          options: [
            { value: "avoid", label: "Avoid" },
            { value: "limited", label: "Few" },
            { value: "allowed", label: "Allowed" },
          ],
        },
        {
          kind: "select",
          key: "exclamations",
          label: "Exclamation marks",
          options: triple("Never", "Rare", "Allowed"),
        },
        { kind: "text", key: "capitalization", label: "Capitalization" },
        { kind: "text", key: "numbers", label: "Numbers" },
        { kind: "text", key: "ctaStyle", label: "CTA style" },
        { kind: "text", key: "headlineStyle", label: "Headline style" },
        { kind: "text", key: "captionStyle", label: "Caption style" },
        { kind: "textarea", key: "notes", label: "Notes" },
      ],
    },
    { kind: "lines", key: "preferredWords", label: "Preferred words", hint: "One per line." },
    { kind: "lines", key: "forbiddenWords", label: "Forbidden words", hint: "One per line." },
    {
      kind: "list",
      key: "spellings",
      label: "Correct spellings",
      addLabel: "Add term",
      item: [
        { kind: "text", key: "term", label: "Term" },
        { kind: "text", key: "note", label: "Note" },
      ],
    },
  ],
};

export const visualUi: SectionUi = {
  section: "visual",
  title: "Visual",
  fields: [
    {
      kind: "object",
      key: "logo",
      label: "Logo",
      item: [
        {
          kind: "list",
          key: "variants",
          label: "Variants",
          withId: true,
          addLabel: "Add variant",
          item: [
            {
              kind: "select",
              key: "role",
              label: "Role",
              options: opts(logoRoles, logoLabels),
              required: true,
            },
            { kind: "source", key: "sourceId", label: "File" },
            {
              kind: "select",
              key: "background",
              label: "Background",
              options: [
                { value: "any", label: "Any" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ],
              required: true,
            },
            { kind: "text", key: "note", label: "Note" },
          ],
        },
        { kind: "text", key: "clearSpace", label: "Clear space" },
        { kind: "number", key: "minSizePx", label: "Minimum size (px)", min: 4, max: 2000 },
        { kind: "text", key: "allowedBackgrounds", label: "Allowed backgrounds" },
        { kind: "lines", key: "forbiddenUses", label: "Forbidden uses" },
      ],
    },
    {
      kind: "sourced-list",
      key: "typography",
      label: "Typography",
      addLabel: "Add font",
      item: [
        {
          kind: "select",
          key: "role",
          label: "Role",
          options: opts(typographyRoles, typoLabels),
          required: true,
        },
        { kind: "text", key: "family", label: "Family" },
        {
          kind: "numbers",
          key: "weights",
          label: "Weights",
          hint: "Comma-separated, e.g. 400, 700.",
        },
        { kind: "text", key: "fallback", label: "Fallback" },
        { kind: "text", key: "license", label: "License" },
        {
          kind: "select",
          key: "licenseStatus",
          label: "License status",
          options: [
            { value: "to_verify", label: "To verify" },
            { value: "verified", label: "Verified" },
          ],
          required: true,
        },
        { kind: "source", key: "sourceId", label: "Font file" },
      ],
    },
    {
      kind: "sourced-object",
      key: "imagery",
      label: "Photography and illustration",
      item: [
        { kind: "lines", key: "subjects", label: "Subjects" },
        { kind: "lines", key: "settings", label: "Locations" },
        { kind: "lines", key: "framing", label: "Framing" },
        { kind: "lines", key: "lighting", label: "Lighting" },
        { kind: "lines", key: "colorMood", label: "Color and mood" },
        { kind: "text", key: "people", label: "People" },
        { kind: "textarea", key: "illustration", label: "Illustration" },
        { kind: "lines", key: "forbidden", label: "Avoid" },
      ],
    },
    {
      kind: "object",
      key: "layout",
      label: "Layout",
      item: [
        { kind: "text", key: "grid", label: "Grid" },
        { kind: "text", key: "margins", label: "Margins" },
        {
          kind: "number",
          key: "maxElements",
          label: "Max elements per slide",
          min: 1,
          max: 30,
        },
        { kind: "text", key: "logoPosition", label: "Logo position" },
        { kind: "text", key: "ctaPosition", label: "CTA position" },
        { kind: "text", key: "textDensity", label: "Text density" },
        { kind: "textarea", key: "notes", label: "Notes" },
      ],
    },
    { kind: "lines", key: "do", label: "Do" },
    { kind: "lines", key: "dont", label: "Don’t" },
  ],
};

export const contentUi: SectionUi = {
  section: "content",
  title: "Content",
  fields: [
    {
      kind: "sourced-list",
      key: "pillars",
      label: "Pillars",
      addLabel: "Add pillar",
      item: [
        {
          kind: "text",
          key: "key",
          label: "Key",
          hint: "Lowercase and hyphens, e.g. behind-the-scenes.",
        },
        { kind: "text", key: "name", label: "Name" },
        { kind: "textarea", key: "goal", label: "Goal" },
        {
          kind: "select",
          key: "funnel",
          label: "Funnel stage",
          options: opts(funnelStages, funnelLabels),
        },
        { kind: "lines", key: "themes", label: "Themes" },
        {
          kind: "text",
          key: "emotion",
          label: "Emotion",
          hint: "Be specific: “relief”, not “positive”.",
        },
        { kind: "text", key: "frequency", label: "Frequency" },
        { kind: "text", key: "cta", label: "CTA" },
        { kind: "lines", key: "forbidden", label: "Forbidden" },
      ],
    },
    {
      kind: "list",
      key: "formats",
      label: "Formats",
      withId: true,
      addLabel: "Add format",
      item: [
        { kind: "text", key: "key", label: "Key" },
        { kind: "text", key: "name", label: "Name" },
        { kind: "textarea", key: "goal", label: "Goal" },
        {
          kind: "list",
          key: "steps",
          label: "Sequence",
          addLabel: "Add step",
          item: [
            { kind: "text", key: "step", label: "Step" },
            { kind: "text", key: "layout", label: "Layout" },
          ],
        },
        {
          kind: "number",
          key: "maxWordsPerSlide",
          label: "Max words per slide",
          min: 1,
          max: 200,
        },
        { kind: "text", key: "cta", label: "CTA" },
      ],
    },
  ],
};

export const channelsUi: SectionUi = {
  section: "channels",
  title: "Channels",
  root: "list",
  fields: [
    {
      kind: "sourced-list",
      key: "",
      label: "Rules per channel",
      addLabel: "Add channel",
      item: [
        {
          kind: "select",
          key: "channel",
          label: "Channel",
          options: opts(channelKeys),
          required: true,
        },
        { kind: "textarea", key: "goal", label: "Goal" },
        { kind: "textarea", key: "toneShift", label: "How the tone changes" },
        { kind: "text", key: "formats", label: "Formats" },
        { kind: "text", key: "frequency", label: "Frequency" },
        { kind: "lines", key: "hashtags", label: "Hashtag" },
        { kind: "text", key: "cta", label: "CTA" },
        { kind: "textarea", key: "notes", label: "Notes" },
      ],
    },
  ],
};
