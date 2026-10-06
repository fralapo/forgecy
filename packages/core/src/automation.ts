/**
 * Batch automations (v1, spec pages 58–59): many draft carousels for one client from a
 * list of briefs or from the items of its 30-day plan. Shared by @forgecy/db and
 * @forgecy/automations. An automation never sends anything for review, approves,
 * publishes or exports: every carousel it creates is a draft.
 */

/** Where the items come from (page 58). */
export const automationSources = ["briefs", "plan"] as const;
export type AutomationSource = (typeof automationSources)[number];

/** `failed` is final: e.g. the client's policy changed to no AI (UXA-P5-05). */
export const automationStatuses = ["draft", "active", "paused", "failed"] as const;
export type AutomationStatus = (typeof automationStatuses)[number];

/** How far each carousel goes: the outline only (default) or the slides too (UXA-P5-09). */
export const automationStopPoints = ["outline", "slides"] as const;
export type AutomationStopPoint = (typeof automationStopPoints)[number];

/** One execution of an automation; `partial` means some items failed. */
export const automationRunStatuses = [
  "running",
  "paused",
  "completed",
  "partial",
  "failed",
  "cancelled",
] as const;
export type AutomationRunStatus = (typeof automationRunStatuses)[number];

export const automationItemStatuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type AutomationItemStatus = (typeof automationItemStatuses)[number];

/** Furthest step an item reached. */
export const automationItemSteps = ["pending", "created", "outline", "slides"] as const;
export type AutomationItemStep = (typeof automationItemSteps)[number];

/** At most 20 carousels per automation (UXA-P5-08). */
export const AUTOMATION_MAX_ITEMS = 20;
