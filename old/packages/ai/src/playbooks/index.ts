/**
 * Agency playbooks: short, versioned know-how appended to the agents' system prompts.
 * Distilled and adapted from fralapo/awesome-agent-skills (MIT, see NOTICE.md); they
 * add craft, never facts, and never override an agent's own rules.
 */
import { copywriting } from "./copywriting";
import { imagery } from "./imagery";
import { positioning } from "./positioning";
import { slideDesign } from "./slides";
import { socialContent } from "./social";
import { websiteReview } from "./website";

/** Bump when any playbook text changes, so jobs_log shows which version a run used. */
export const PLAYBOOK_VERSION = "playbooks-2026-10-06";

export const playbooks = {
  "social-content": socialContent,
  positioning,
  copywriting,
  imagery,
  "website-review": websiteReview,
  "slide-design": slideDesign,
} as const;

export type PlaybookId = keyof typeof playbooks;

/** Upstream skill each playbook was adapted from (for attribution and updates). */
export const playbookSources: Record<PlaybookId, readonly string[]> = {
  "social-content": ["social-algorithm"],
  positioning: ["marketing-mba"],
  copywriting: ["creative-director", "public-speaking-persuasion"],
  imagery: ["image-gen-prompts"],
  "website-review": ["ux-ui-expert", "geo-ai-visibility"],
  "slide-design": ["ux-ui-expert"],
};

/**
 * The block to append to a system prompt. The agent's own rules come first and win:
 * the playbooks only say how to do the work well.
 */
export function withPlaybooks(system: string, ...ids: PlaybookId[]): string {
  if (!ids.length) return system;
  const body = [...new Set(ids)].map((id) => playbooks[id]).join("\n\n");
  return `${system}\n\n# Agency playbook (craft guidance; the rules above always prevail)\n${body}`;
}
