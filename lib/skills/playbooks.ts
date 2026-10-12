/**
 * Forgecy-native, original operational playbooks. Inspired by MIT-licensed
 * https://github.com/fralapo/awesome-agent-skills (reviewed 2026-10-12).
 * We paraphrase decision rules; no source books/chapters are redistributed.
 * Stages are selected by intent, never sent wholesale to one huge prompt.
 */
export const SKILL_PROVENANCE = "https://github.com/fralapo/awesome-agent-skills" as const;
export const stageSkills = {
  research: ["llm-wiki", "marketing-mba"],
  analyst: ["social-algorithm", "marketing-mba"],
  strategist: ["marketing-mba", "social-algorithm", "creative-director"],
  creative: ["creative-director", "public-speaking-persuasion", "social-algorithm"],
  quality: ["creative-director", "ux-ui-expert"],
  imagery: ["image-gen-prompts", "creative-director"],
  geo: ["geo-ai-visibility"],
} as const;
export type SkillStage = keyof typeof stageSkills;

const playbooks: Record<SkillStage, string> = {
 research: [
  "Construct a client-specific evidence inventory: original immutable source, extracted text, source ID, capture date, and confidence.",
  "Distinguish current verified company truth from inferred positioning or community anecdotes. Do not silently replace an older claim when a conflict is found: flag the contradiction.",
  "Only approved/verified offers may support commercial promises. Preserve uncertainty and missing information; no invented case studies.",
 ].join("\n"),
 analyst: [
  "Segment by actual audience need and use occasion, not invented demographic personas. A segment must be actionable and reachable.",
  "Read community signals with provenance and distinguish isolated feedback from independently recurring topics.",
  "Historical channel numbers are observational, not causal proof. Attribute measured data to exact platform/time and never claim proprietary knowledge of ranking weights.",
  "Separate audience awareness, education, consideration, and conversion needs; recommend relevant static content and measurable KPIs.",
 ].join("\n"),
 strategist: [
  "Describe one clear strategic theory of winning: audience segment, unmet need, distinctive value proposition, credible proof, channel, and falsifiable KPI.",
  "Every campaign must align to the chosen verified product/service, its real benefits, availability, and stated price if present.",
  "Balance useful, trust-building and promotional content. Avoid promoting every item at once, and do not mistake an editorial calendar for a strategy.",
  "Design recurring visual/content formats only when supported by audience insight and existing brand identity. Distinguish hypotheses from tested formats.",
 ].join("\n"),
 creative: [
  "Find a genuine audience tension before choosing the campaign idea. Separate the central campaign concept from each individual post execution.",
  "Write specific, useful, plain-language hooks that honestly promise a result delivered by subsequent slides or text. Do not use empty hype, generic formulas, made-up numbers or scarcity.",
  "Use one persuasive message per post and one meaningful call to action at most. Include audience need, emotional benefit and verifiable practical proof in the editorial brief.",
  "Adapt LinkedIn to professional context and Instagram to static feed reading behavior; do not merely duplicate text between channels.",
  "Make layouts readable at phone size and leave breathing room around text. Avoid asking a text-heavy AI image generator to render typography: type is composed later in the editor.",
 ].join("\n"),
 quality: [
  "Act as an adversarial editor, not a cheerleader. Reject unsupported product claims, made-up performance, manipulative appeals and unfulfilled hooks.",
  "Evaluate separately: strategic fit, originality, audience relevance, evidence, craft/readability and feasibility. Explain shortcomings instead of inflating scores.",
  "Check Instagram/LinkedIn format consistency, accessibility, brand consistency, one CTA, completeness of story and source traceability.",
  "State which problems are blocking before human approval. A model score is an editorial aid, never proof of business performance.",
 ].join("\n"),
 imagery: [
  "Describe exactly one visual subject, context, composition, light, material, palette, camera angle and intended aspect ratio.",
  "Use verified visual references only when supplied; preserve the product's true shape and markings, do not invent brand marks or endorsements.",
  "Generate a clean background or photograph with appropriate negative space. Do not embed captions, logos, calls-to-action or extensive text: the editor overlays typography.",
  "Avoid impossible physical claims, fake packaging labels, medical implications or photoreal representations of named people without permission.",
 ].join("\n"),
 geo: [
  "Evaluate answer-first, self-contained headings, consistent named entities, attributable claims and crawlability; never claim that changing metadata guarantees AI citations.",
  "Structured data must match business facts. Check city/service pages against actual location, do not suggest doorway pages or invented addresses.",
  "Keep separate measurements for each search/answer provider; apparent AI visibility cannot be estimated reliably from the model's own opinion.",
 ].join("\n"),
};
export function playbook(stage: SkillStage): string {
 return playbooks[stage];
}
export function routedSkills(stage:SkillStage): readonly string[]{
 return stageSkills[stage];
}
