/**
 * buildBrandContext: the brand block of a generation prompt (spec "Brand context
 * builder"). Built only from a published version, so only approved elements reach
 * the model. Token values never enter the prompt: the model gets role names and
 * the renderer applies the values. The stable part comes first so providers can
 * cache it; examples, memory and brief follow.
 */
import { type BrandIdentityDocument, toneAxes } from "./document";
import { tokenRoleNames, type TokenTree } from "./tokens";

export interface ContextExample {
  id: string;
  kind: string;
  verdict: "approved" | "rejected";
  body: string;
  reason: string;
  channel: string | null;
  pillarKey: string | null;
  formatKey: string | null;
  createdAt: Date;
}

export interface BrandContextInput {
  versionId: string;
  number: number;
  document: BrandIdentityDocument;
  tokens: TokenTree;
}

export interface BrandContextOptions {
  channel?: string;
  formatKey?: string;
  pillarKey?: string;
  examples?: readonly ContextExample[];
  /** Relevant memory rules, already ordered by the memory module's priority. */
  memoryRules?: readonly string[];
  brief?: string;
  /** Cap for the brand block in tokens (default 6000). */
  maxTokens?: number;
  /** Approved examples to include (3–5) and rejected ones (2). */
  approvedExamples?: number;
  rejectedExamples?: number;
}

export interface BrandContext {
  versionId: string;
  versionNumber: number;
  /** Identity and rules of the version: identical across calls, cacheable. */
  stable: string;
  /** Channel, format, examples, memory and brief. */
  variable: string;
  estimatedTokens: number;
  examplesUsed: string[];
  examplesDropped: number;
  /** True when even without examples the block exceeds `maxTokens` (binding rules are never cut). */
  overBudget: boolean;
}

/** Rough token estimate for Italian text (about 3.5 characters per token). */
export const estimateTokens = (s: string) => Math.ceil(s.length / 3.5);

const live = <T extends { deprecated?: boolean | undefined }>(items: readonly T[]) =>
  items.filter((i) => !i.deprecated);
const bullet = (lines: readonly string[]) => lines.map((l) => `- ${l}`).join("\n");

function section(title: string, body: string | undefined | false): string {
  return body ? `## ${title}\n${body}` : "";
}

function pickExamples(
  examples: readonly ContextExample[],
  verdict: "approved" | "rejected",
  count: number,
  o: BrandContextOptions,
): ContextExample[] {
  const score = (e: ContextExample) => {
    let s = 0;
    for (const [have, want] of [
      [e.channel, o.channel],
      [e.formatKey, o.formatKey],
      [e.pillarKey, o.pillarKey],
    ] as const) {
      if (have && want && have === want) s += 2;
      else if (have && want && have !== want) return -1;
      else if (!have) s += 0;
    }
    return s;
  };
  return examples
    .filter((e) => e.verdict === verdict && score(e) >= 0)
    .sort((a, b) => score(b) - score(a) || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, count);
}

export function buildBrandContext(
  identity: BrandContextInput,
  options: BrandContextOptions = {},
): BrandContext {
  const d = identity.document;
  const s = d.strategy;
  const v = d.verbal;
  const maxTokens = options.maxTokens ?? 6000;

  // ---- Stable part ----
  const identityLines = [
    s.oneLiner && `One-liner: ${s.oneLiner.value}`,
    s.positioning && `Positioning: ${s.positioning.value}`,
    s.promise && `Promise: ${s.promise.value}`,
    s.differentiation && `Differentiation: ${s.differentiation.value}`,
    s.insight && `Insight: ${s.insight.value}`,
  ].filter(Boolean) as string[];

  const voiceLines: string[] = [];
  if (v.voice) voiceLines.push(`Voice: ${v.voice.value}`);
  const weAre = live(v.weAreWeAreNot);
  if (weAre.length)
    voiceLines.push(
      "We are / We are not:",
      ...weAre.map((w) => `  - We are ${w.value.weAre}, not ${w.value.weAreNot}`),
    );
  for (const a of live(v.toneAxes)) {
    const def = toneAxes.find((t) => t.key === a.value.axis);
    if (!def) continue;
    voiceLines.push(
      `Axis ${def.left}/${def.right}: ${a.value.value} out of 5 (1 = ${def.left.toLowerCase()}, 5 = ${def.right.toLowerCase()}). Right: “${a.value.goodExample}”. Wrong: “${a.value.badExample}”.`,
    );
  }

  const rules: string[] = [];
  const w = v.writingRules?.value;
  if (w) {
    if (w.person) rules.push(`Address the reader as: ${w.person}`);
    if (w.emoji)
      rules.push(`Emoji: ${{ no: "never", limited: "sparingly", yes: "allowed" }[w.emoji]}`);
    if (w.maxSentenceWords) rules.push(`Sentences of at most ${w.maxSentenceWords} words`);
    if (w.maxHashtags !== undefined) rules.push(`At most ${w.maxHashtags} hashtags`);
    if (w.anglicisms)
      rules.push(
        `Anglicisms: ${{ avoid: "avoid", limited: "few", allowed: "allowed" }[w.anglicisms]}`,
      );
    if (w.exclamations)
      rules.push(
        `Exclamation marks: ${{ no: "never", limited: "rare", yes: "allowed" }[w.exclamations]}`,
      );
    for (const [label, val] of [
      ["Capitalization", w.capitalization],
      ["Numbers", w.numbers],
      ["CTA", w.ctaStyle],
      ["Headline", w.headlineStyle],
      ["Caption", w.captionStyle],
      ["Notes", w.notes],
    ] as const)
      if (val) rules.push(`${label}: ${val}`);
  }
  if (v.forbiddenWords.length)
    rules.push(`Forbidden words (never use them): ${v.forbiddenWords.join(", ")}`);
  if (v.preferredWords.length) rules.push(`Preferred words: ${v.preferredWords.join(", ")}`);
  if (v.spellings.length)
    rules.push(`Correct spelling: ${v.spellings.map((x) => x.term).join(", ")}`);
  const avoid = live(s.avoidTopics);
  if (avoid.length) rules.push(`Topics to avoid: ${avoid.map((t) => t.value).join("; ")}`);
  const values = live(s.values);
  if (values.length) rules.push(`Values: ${values.map((x) => x.value.name).join(", ")}`);

  const roles = tokenRoleNames(identity.tokens);
  const stable = [
    `# Brand Identity v${identity.number}`,
    section("Identity", identityLines.length ? identityLines.join("\n") : undefined),
    section("Voice and tone", voiceLines.length ? voiceLines.join("\n") : undefined),
    section("Binding rules", rules.length ? bullet(rules) : undefined),
    section(
      "Available visual roles",
      roles.length
        ? `Choose layouts and roles by name; the renderer applies the values.\n${roles.join(", ")}`
        : undefined,
    ),
  ]
    .filter(Boolean)
    .join("\n\n");

  // ---- Variable part ----
  const pillar = options.pillarKey
    ? live(d.content.pillars).find((p) => p.value.key === options.pillarKey)
    : undefined;
  const audience = pillar?.value.audienceId
    ? live(s.audience).find((a) => a.id === pillar.value.audienceId)
    : live(s.audience)[0];
  const channel = options.channel
    ? live(d.channels).find((c) => c.value.channel === options.channel)
    : undefined;
  const format = options.formatKey
    ? d.content.formats.find((f) => f.key === options.formatKey)
    : undefined;

  const fixed: string[] = [];
  if (audience) {
    const a = audience.value;
    fixed.push(
      section(
        "Audience",
        [
          `Segment: ${a.name}${a.role ? ` (${a.role})` : ""}`,
          a.problems && `Problems: ${a.problems}`,
          a.goals && `Goals: ${a.goals}`,
          a.objections && `Objections: ${a.objections}`,
          a.language && `Language: ${a.language}`,
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    );
  }
  if (pillar) {
    const p = pillar.value;
    fixed.push(
      section(
        "Pillar",
        [
          `${p.name}: ${p.goal}`,
          p.emotion && `Emotion to evoke: ${p.emotion}`,
          p.cta && `CTA: ${p.cta}`,
          p.forbidden.length && `Forbidden: ${p.forbidden.join("; ")}`,
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    );
  }
  if (channel) {
    const c = channel.value;
    fixed.push(
      section(
        `Channel ${c.channel}`,
        [
          c.toneShift && `Tone shift: ${c.toneShift}`,
          c.goal && `Goal: ${c.goal}`,
          c.hashtags.length && `Hashtag: ${c.hashtags.join(" ")}`,
          c.cta && `CTA: ${c.cta}`,
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    );
  }
  if (format) {
    fixed.push(
      section(
        `Format ${format.name}`,
        [
          format.goal && `Goal: ${format.goal}`,
          format.steps.length &&
            `Sequence:\n${format.steps.map((st, i) => `${i + 1}. ${st.step}${st.layout ? ` (layout ${st.layout})` : ""}`).join("\n")}`,
          format.maxWordsPerSlide && `At most ${format.maxWordsPerSlide} words per slide`,
          format.cta && `CTA: ${format.cta}`,
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    );
  }
  if (options.memoryRules?.length) fixed.push(section("Memory rules", bullet(options.memoryRules)));

  const approved = pickExamples(
    options.examples ?? [],
    "approved",
    options.approvedExamples ?? 5,
    options,
  );
  const rejected = pickExamples(
    options.examples ?? [],
    "rejected",
    options.rejectedExamples ?? 2,
    options,
  );
  const renderExamples = (a: ContextExample[], r: ContextExample[]) =>
    [
      a.length &&
        section(
          "Approved examples",
          a.map((e) => `“${e.body}”\nWhy it works: ${e.reason}`).join("\n\n"),
        ),
      r.length &&
        section(
          "Rejected examples",
          r.map((e) => `“${e.body}”\nWhy not: ${e.reason}`).join("\n\n"),
        ),
    ]
      .filter(Boolean)
      .join("\n\n");
  const brief = options.brief ? section("Brief", options.brief) : "";

  // Cut the oldest examples first; binding rules are never cut.
  const a = [...approved];
  const r = [...rejected];
  const build = () => [...fixed, renderExamples(a, r), brief].filter(Boolean).join("\n\n");
  let variable = build();
  const total = () => estimateTokens(`${stable}\n\n${variable}`);
  let dropped = 0;
  const oldest = (list: ContextExample[]) =>
    list.reduce((min, e, i) => (e.createdAt < list[min]!.createdAt ? i : min), 0);
  while (total() > maxTokens && a.length + r.length > 0) {
    if (a.length >= r.length && a.length) a.splice(oldest(a), 1);
    else r.splice(oldest(r), 1);
    dropped++;
    variable = build();
  }
  return {
    versionId: identity.versionId,
    versionNumber: identity.number,
    stable,
    variable,
    estimatedTokens: total(),
    examplesUsed: [...a, ...r].map((e) => e.id),
    examplesDropped: dropped,
    overBudget: total() > maxTokens,
  };
}
