/**
 * In-app notifications (bell in the header, v1). Each kind has a message in
 * `notifications.kinds.<kind>` (packages/i18n), rendered in the reader's language
 * with the parameters stored on the row. Stored as text, so a new kind needs no
 * migration.
 */
export const notificationKinds = [
  "content_review_requested",
  "content_approved",
  "content_changes_requested",
  "brand_review_requested",
  "brand_changes_requested",
  "brand_published",
  "report_review_requested",
  "report_approved",
  "report_changes_requested",
  "automation_run_finished",
  "client_export_ready",
  "client_import_done",
  "client_import_failed",
] as const;
export type NotificationKind = (typeof notificationKinds)[number];

/** ICU values of a notification message: plain strings and numbers only. */
export type NotificationParams = Record<string, string | number>;
