import "server-only";
import type { ReadinessItem } from "@forgecy/audit";
import { AUDIT_LIMITS } from "@forgecy/core";
import type { getTranslations } from "next-intl/server";

type AuditT = Awaited<ReturnType<typeof getTranslations<"audit">>>;

/** Checklist item before the report, in the user's language. */
export function readinessLabel(t: AuditT, item: ReadinessItem): string {
  if (item.key === "problems")
    return t("readiness.problems", {
      min: AUDIT_LIMITS.minProblems,
      max: AUDIT_LIMITS.maxProblems,
    });
  return t(`readiness.${item.key}`);
}

/** The detail next to an item (counts), or the stored English text without a count. */
export function readinessDetail(t: AuditT, item: ReadinessItem): string | null {
  if (!item.detail) return null;
  if (item.count === undefined || item.key === "competitors") return item.detail;
  return t(`readiness.${item.key}Detail`, { count: item.count });
}
