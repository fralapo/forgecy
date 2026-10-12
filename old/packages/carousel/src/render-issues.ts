import { labelSlotRef } from "./interface-labels";
import type { TemplateManifest } from "./template-schema";

type Ref = { key: string; values?: Record<string, string | number> | undefined };

export interface RenderIssueView {
  slide: number;
  slot: string;
  kind: string;
  message: string;
  severity: "error" | "warning";
  ref?: Ref;
}

export interface RenderIssueGroup {
  /** 0-based slide index. */
  slide: number;
  issues: RenderIssueView[];
}

const ERROR_KINDS = new Set(["overflow", "outside_slide", "image_missing"]);

/**
 * The `issues` of an export job result (unknown JSON) grouped by slide, errors first. Malformed
 * entries are dropped. A `slot` value in the ref is shown as the slot's interface label.
 */
export function groupRenderIssues(
  raw: unknown,
  manifest: Pick<TemplateManifest, "layouts"> | null | undefined,
  layoutOf: (slide: number) => string | null | undefined,
  source?: Pick<TemplateManifest, "layouts"> | null,
): RenderIssueGroup[] {
  if (!Array.isArray(raw)) return [];
  const groups = new Map<number, RenderIssueView[]>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.slide !== "number" || typeof o.kind !== "string") continue;
    const ref =
      o.ref && typeof (o.ref as Ref).key === "string"
        ? labelSlotRef(o.ref as Ref, manifest, layoutOf(o.slide), source)
        : undefined;
    const issue: RenderIssueView = {
      slide: o.slide,
      slot: typeof o.slot === "string" ? o.slot : "",
      kind: o.kind,
      message: typeof o.message === "string" ? o.message : o.kind,
      severity:
        o.severity === "error" || o.severity === "warning"
          ? o.severity
          : ERROR_KINDS.has(o.kind)
            ? "error"
            : "warning",
      ...(ref ? { ref } : {}),
    };
    groups.set(o.slide, [...(groups.get(o.slide) ?? []), issue]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([slide, issues]) => ({
      slide,
      issues: [...issues].sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error")),
    }));
}
