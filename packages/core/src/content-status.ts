/**
 * Content state machine (spec: "Modello dati e API"): Bozza → In revisione interna →
 * Approvato → Esportato, with "Modifiche richieste" sending it back to Bozza.
 */
import type { Permission } from "./permissions";

export const contentStatuses = ["draft", "in_review", "changes_requested", "approved", "exported", "archived"] as const;
export type ContentStatus = (typeof contentStatuses)[number];

type Transition = { to: ContentStatus; permission: Permission };

const transitions: Record<ContentStatus, readonly Transition[]> = {
  draft: [
    { to: "in_review", permission: "edit_draft" },
    { to: "archived", permission: "archive" },
  ],
  in_review: [
    { to: "approved", permission: "approve" },
    { to: "changes_requested", permission: "review" },
    { to: "draft", permission: "edit_draft" },
  ],
  changes_requested: [
    { to: "draft", permission: "edit_draft" },
    { to: "archived", permission: "archive" },
  ],
  approved: [
    { to: "exported", permission: "reports.export" },
    { to: "draft", permission: "edit_draft" },
    { to: "archived", permission: "archive" },
  ],
  exported: [
    { to: "draft", permission: "edit_draft" },
    { to: "archived", permission: "archive" },
  ],
  archived: [{ to: "draft", permission: "archive" }],
};

export function allowedTransitions(from: ContentStatus): readonly Transition[] {
  return transitions[from];
}

/** Returns the permission the transition needs, or null when it is not allowed at all. */
export function transitionPermission(from: ContentStatus, to: ContentStatus): Permission | null {
  return transitions[from].find((t) => t.to === to)?.permission ?? null;
}
