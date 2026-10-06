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
import type { MessageKey } from "@forgecy/i18n";

/** A message key under `brand.editor` (packages/i18n/messages/<locale>/brand.json). */
export type EditorKey = MessageKey extends infer K
  ? K extends `brand.editor.${infer R}`
    ? R
    : never
  : never;

/** `label` is a message key; without one the value itself is shown (channel names). */
export type Option = { value: string; label?: EditorKey };
const opts = (values: readonly string[], group?: string): Option[] =>
  values.map((v) =>
    group ? { value: v, label: `options.${group}.${v}` as EditorKey } : { value: v },
  );

export type Ctl =
  | { kind: "text"; key: string; label: EditorKey; hint?: EditorKey }
  | { kind: "textarea"; key: string; label: EditorKey; hint?: EditorKey; maxWords?: number }
  | { kind: "number"; key: string; label: EditorKey; min?: number; max?: number }
  | { kind: "select"; key: string; label: EditorKey; options: Option[]; required?: boolean }
  | { kind: "scale"; key: string; label: EditorKey; min: number; max: number }
  | { kind: "lines"; key: string; label: EditorKey; hint?: EditorKey }
  | { kind: "numbers"; key: string; label: EditorKey; hint?: EditorKey }
  | {
      kind: "list";
      key: string;
      label: EditorKey;
      item: Ctl[];
      withId?: boolean;
      addLabel: EditorKey;
    }
  | { kind: "source"; key: string; label: EditorKey };

export type FieldUi =
  | {
      kind: "sourced";
      key: string;
      label: EditorKey;
      multiline?: boolean;
      hint?: EditorKey;
      maxWords?: number;
    }
  | { kind: "sourced-object"; key: string; label: EditorKey; item: Ctl[] }
  | {
      kind: "sourced-list";
      key: string;
      label: EditorKey;
      item: Ctl[] | "text";
      addLabel: EditorKey;
      hint?: EditorKey;
    }
  | { kind: "lines"; key: string; label: EditorKey; hint?: EditorKey }
  | { kind: "object"; key: string; label: EditorKey; item: Ctl[] }
  | {
      kind: "list";
      key: string;
      label: EditorKey;
      item: Ctl[];
      withId?: boolean;
      addLabel: EditorKey;
    };

export interface SectionUi {
  section: DocumentSectionKey;
  title: EditorKey;
  /** "list" when the section itself is an array (channels). */
  root?: "list";
  fields: FieldUi[];
}

// Values are the Italian grammatical persons stored in the document; labels explain them.
const persons = ["tu", "lei", "voi", "noi", "impersonale"];

export const strategyUi: SectionUi = {
  section: "strategy",
  title: "sections.strategy",
  fields: [
    {
      kind: "sourced",
      key: "oneLiner",
      label: "strategy.oneLiner",
      hint: "strategy.oneLinerHint",
      maxWords: 20,
    },
    { kind: "sourced", key: "insight", label: "strategy.insight", multiline: true },
    { kind: "sourced", key: "positioning", label: "strategy.positioning", multiline: true },
    { kind: "sourced", key: "promise", label: "strategy.promise", multiline: true },
    { kind: "sourced", key: "differentiation", label: "strategy.differentiation", multiline: true },
    { kind: "sourced", key: "mission", label: "strategy.mission", multiline: true },
    { kind: "sourced", key: "vision", label: "strategy.vision", multiline: true },
    { kind: "sourced", key: "category", label: "strategy.category" },
    {
      kind: "sourced-list",
      key: "values",
      label: "strategy.values",
      addLabel: "strategy.addValue",
      item: [
        { kind: "text", key: "name", label: "strategy.valueName" },
        { kind: "textarea", key: "description", label: "strategy.valueMeaning" },
      ],
    },
    {
      kind: "sourced-list",
      key: "audience",
      label: "strategy.audience",
      addLabel: "strategy.addSegment",
      item: [
        { kind: "text", key: "name", label: "strategy.segment" },
        { kind: "text", key: "role", label: "strategy.role" },
        { kind: "text", key: "sector", label: "strategy.sector" },
        {
          kind: "select",
          key: "awareness",
          label: "strategy.awareness",
          options: opts(awarenessLevels, "awareness"),
        },
        { kind: "textarea", key: "goals", label: "strategy.goals" },
        { kind: "textarea", key: "problems", label: "strategy.problems" },
        { kind: "textarea", key: "fears", label: "strategy.fears" },
        { kind: "textarea", key: "objections", label: "strategy.objections" },
        { kind: "textarea", key: "triggers", label: "strategy.triggers" },
        { kind: "textarea", key: "language", label: "strategy.language" },
        { kind: "text", key: "channels", label: "strategy.channels" },
        { kind: "textarea", key: "alternatives", label: "strategy.alternatives" },
      ],
    },
    {
      kind: "sourced-list",
      key: "messages",
      label: "strategy.messages",
      addLabel: "strategy.addMessage",
      hint: "strategy.messagesHint",
      item: [
        {
          kind: "select",
          key: "kind",
          label: "strategy.messageType",
          options: opts(messageKinds, "messageKind"),
          required: true,
        },
        { kind: "textarea", key: "text", label: "strategy.messageText" },
        { kind: "textarea", key: "proof", label: "strategy.proof" },
        { kind: "textarea", key: "answer", label: "strategy.answer" },
      ],
    },
    {
      kind: "sourced-list",
      key: "avoidTopics",
      label: "strategy.avoidTopics",
      addLabel: "strategy.addTopic",
      item: "text",
    },
  ],
};

export const competitorsUi: SectionUi = {
  section: "competitors",
  title: "sections.competitors",
  fields: [
    {
      kind: "sourced-list",
      key: "list",
      label: "competitors.list",
      addLabel: "competitors.add",
      item: [
        { kind: "text", key: "name", label: "competitors.name" },
        {
          kind: "select",
          key: "kind",
          label: "competitors.type",
          options: opts(["direct", "indirect", "alternative"], "competitorKind"),
          required: true,
        },
        { kind: "text", key: "url", label: "competitors.website" },
        { kind: "textarea", key: "notes", label: "competitors.notes" },
      ],
    },
    { kind: "lines", key: "overusedMessages", label: "competitors.overusedMessages" },
    { kind: "lines", key: "commonVisualCodes", label: "competitors.commonVisualCodes" },
    { kind: "lines", key: "openSpaces", label: "competitors.openSpaces" },
  ],
};

export const verbalUi: SectionUi = {
  section: "verbal",
  title: "sections.verbal",
  fields: [
    {
      kind: "sourced",
      key: "voice",
      label: "verbal.voice",
      multiline: true,
      hint: "verbal.voiceHint",
    },
    {
      kind: "sourced-list",
      key: "toneAxes",
      label: "verbal.toneAxes",
      addLabel: "verbal.addAxis",
      hint: "verbal.toneAxesHint",
      item: [
        {
          kind: "select",
          key: "axis",
          label: "verbal.axis",
          options: opts(
            toneAxes.map((a) => a.key),
            "toneAxis",
          ),
          required: true,
        },
        {
          kind: "scale",
          key: "value",
          label: "verbal.position",
          min: 1,
          max: 5,
        },
        { kind: "textarea", key: "goodExample", label: "verbal.goodExample" },
        { kind: "textarea", key: "badExample", label: "verbal.badExample" },
      ],
    },
    {
      kind: "sourced-list",
      key: "weAreWeAreNot",
      label: "verbal.weAreWeAreNot",
      addLabel: "verbal.addRow",
      item: [
        { kind: "text", key: "weAre", label: "verbal.weAre" },
        { kind: "text", key: "weAreNot", label: "verbal.weAreNot" },
      ],
    },
    {
      kind: "sourced-object",
      key: "writingRules",
      label: "verbal.writingRules",
      item: [
        {
          kind: "select",
          key: "person",
          label: "verbal.person",
          options: opts(persons, "person"),
        },
        {
          kind: "select",
          key: "emoji",
          label: "verbal.emoji",
          options: opts(["no", "limited", "yes"], "emoji"),
        },
        {
          kind: "number",
          key: "maxSentenceWords",
          label: "verbal.maxSentenceWords",
          min: 3,
          max: 80,
        },
        { kind: "number", key: "maxHashtags", label: "verbal.maxHashtags", min: 0, max: 30 },
        {
          kind: "select",
          key: "anglicisms",
          label: "verbal.anglicisms",
          options: opts(["avoid", "limited", "allowed"], "anglicisms"),
        },
        {
          kind: "select",
          key: "exclamations",
          label: "verbal.exclamations",
          options: opts(["no", "limited", "yes"], "exclamations"),
        },
        { kind: "text", key: "capitalization", label: "verbal.capitalization" },
        { kind: "text", key: "numbers", label: "verbal.numbers" },
        { kind: "text", key: "ctaStyle", label: "verbal.ctaStyle" },
        { kind: "text", key: "headlineStyle", label: "verbal.headlineStyle" },
        { kind: "text", key: "captionStyle", label: "verbal.captionStyle" },
        { kind: "textarea", key: "notes", label: "verbal.notes" },
      ],
    },
    {
      kind: "lines",
      key: "preferredWords",
      label: "verbal.preferredWords",
      hint: "verbal.onePerLine",
    },
    {
      kind: "lines",
      key: "forbiddenWords",
      label: "verbal.forbiddenWords",
      hint: "verbal.onePerLine",
    },
    {
      kind: "list",
      key: "spellings",
      label: "verbal.spellings",
      addLabel: "verbal.addTerm",
      item: [
        { kind: "text", key: "term", label: "verbal.term" },
        { kind: "text", key: "note", label: "verbal.note" },
      ],
    },
  ],
};

export const visualUi: SectionUi = {
  section: "visual",
  title: "sections.visual",
  fields: [
    {
      kind: "object",
      key: "logo",
      label: "visual.logo",
      item: [
        {
          kind: "list",
          key: "variants",
          label: "visual.variants",
          withId: true,
          addLabel: "visual.addVariant",
          item: [
            {
              kind: "select",
              key: "role",
              label: "visual.role",
              options: opts(logoRoles, "logoRole"),
              required: true,
            },
            { kind: "source", key: "sourceId", label: "visual.file" },
            {
              kind: "select",
              key: "background",
              label: "visual.background",
              options: opts(["any", "light", "dark"], "background"),
              required: true,
            },
            { kind: "text", key: "note", label: "visual.note" },
          ],
        },
        { kind: "text", key: "clearSpace", label: "visual.clearSpace" },
        { kind: "number", key: "minSizePx", label: "visual.minSize", min: 4, max: 2000 },
        { kind: "text", key: "allowedBackgrounds", label: "visual.allowedBackgrounds" },
        { kind: "lines", key: "forbiddenUses", label: "visual.forbiddenUses" },
      ],
    },
    {
      kind: "sourced-list",
      key: "typography",
      label: "visual.typography",
      addLabel: "visual.addFont",
      item: [
        {
          kind: "select",
          key: "role",
          label: "visual.role",
          options: opts(typographyRoles, "typographyRole"),
          required: true,
        },
        { kind: "text", key: "family", label: "visual.family" },
        {
          kind: "numbers",
          key: "weights",
          label: "visual.weights",
          hint: "visual.weightsHint",
        },
        { kind: "text", key: "fallback", label: "visual.fallback" },
        { kind: "text", key: "license", label: "visual.license" },
        {
          kind: "select",
          key: "licenseStatus",
          label: "visual.licenseStatus",
          options: opts(["to_verify", "verified"], "licenseStatus"),
          required: true,
        },
        { kind: "source", key: "sourceId", label: "visual.fontFile" },
      ],
    },
    {
      kind: "sourced-object",
      key: "imagery",
      label: "visual.imagery",
      item: [
        { kind: "lines", key: "subjects", label: "visual.subjects" },
        { kind: "lines", key: "settings", label: "visual.locations" },
        { kind: "lines", key: "framing", label: "visual.framing" },
        { kind: "lines", key: "lighting", label: "visual.lighting" },
        { kind: "lines", key: "colorMood", label: "visual.colorMood" },
        { kind: "text", key: "people", label: "visual.people" },
        { kind: "textarea", key: "illustration", label: "visual.illustration" },
        { kind: "lines", key: "forbidden", label: "visual.avoid" },
      ],
    },
    {
      kind: "object",
      key: "layout",
      label: "visual.layout",
      item: [
        { kind: "text", key: "grid", label: "visual.grid" },
        { kind: "text", key: "margins", label: "visual.margins" },
        {
          kind: "number",
          key: "maxElements",
          label: "visual.maxElements",
          min: 1,
          max: 30,
        },
        { kind: "text", key: "logoPosition", label: "visual.logoPosition" },
        { kind: "text", key: "ctaPosition", label: "visual.ctaPosition" },
        { kind: "text", key: "textDensity", label: "visual.textDensity" },
        { kind: "textarea", key: "notes", label: "visual.notes" },
      ],
    },
    { kind: "lines", key: "do", label: "visual.do" },
    { kind: "lines", key: "dont", label: "visual.dont" },
  ],
};

export const contentUi: SectionUi = {
  section: "content",
  title: "sections.content",
  fields: [
    {
      kind: "sourced-list",
      key: "pillars",
      label: "content.pillars",
      addLabel: "content.addPillar",
      item: [
        {
          kind: "text",
          key: "key",
          label: "content.key",
          hint: "content.keyHint",
        },
        { kind: "text", key: "name", label: "content.name" },
        { kind: "textarea", key: "goal", label: "content.goal" },
        {
          kind: "select",
          key: "funnel",
          label: "content.funnel",
          options: opts(funnelStages, "funnel"),
        },
        { kind: "lines", key: "themes", label: "content.themes" },
        {
          kind: "text",
          key: "emotion",
          label: "content.emotion",
          hint: "content.emotionHint",
        },
        { kind: "text", key: "frequency", label: "content.frequency" },
        { kind: "text", key: "cta", label: "content.cta" },
        { kind: "lines", key: "forbidden", label: "content.forbidden" },
      ],
    },
    {
      kind: "list",
      key: "formats",
      label: "content.formats",
      withId: true,
      addLabel: "content.addFormat",
      item: [
        { kind: "text", key: "key", label: "content.key" },
        { kind: "text", key: "name", label: "content.name" },
        { kind: "textarea", key: "goal", label: "content.goal" },
        {
          kind: "list",
          key: "steps",
          label: "content.sequence",
          addLabel: "content.addStep",
          item: [
            { kind: "text", key: "step", label: "content.step" },
            { kind: "text", key: "layout", label: "content.layout" },
          ],
        },
        {
          kind: "number",
          key: "maxWordsPerSlide",
          label: "content.maxWordsPerSlide",
          min: 1,
          max: 200,
        },
        { kind: "text", key: "cta", label: "content.cta" },
      ],
    },
  ],
};

export const channelsUi: SectionUi = {
  section: "channels",
  title: "sections.channels",
  root: "list",
  fields: [
    {
      kind: "sourced-list",
      key: "",
      label: "channels.rules",
      addLabel: "channels.addChannel",
      item: [
        {
          kind: "select",
          key: "channel",
          label: "channels.channel",
          options: opts(channelKeys),
          required: true,
        },
        { kind: "textarea", key: "goal", label: "channels.goal" },
        { kind: "textarea", key: "toneShift", label: "channels.toneShift" },
        { kind: "text", key: "formats", label: "channels.formats" },
        { kind: "text", key: "frequency", label: "channels.frequency" },
        { kind: "lines", key: "hashtags", label: "channels.hashtags" },
        { kind: "text", key: "cta", label: "channels.cta" },
        { kind: "textarea", key: "notes", label: "channels.notes" },
      ],
    },
  ],
};
