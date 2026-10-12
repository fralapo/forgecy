import type { MessageRef } from "@forgecy/core";
import type { Provenance } from "@forgecy/content";
import type { getRefText } from "@/lib/i18n";

type RefText = Awaited<ReturnType<typeof getRefText>>;

/** Proposals saved before sources carried a reference: their English labels, recognized. */
function legacyRef(label: string): MessageRef | undefined {
  if (label === "Current strategy") return { key: "content.labels.source.strategy" };
  if (label === "Product catalog") return { key: "content.labels.source.catalog" };
  let m = /^Brand Identity v(\d+)$/.exec(label);
  if (m) return { key: "content.labels.source.brand", values: { version: Number(m[1]) } };
  m = /^(\d+) pillars, (\d+) rubrics$/.exec(label);
  if (m)
    return {
      key: "content.labels.source.strategyCounts",
      values: { pillars: Number(m[1]), rubrics: Number(m[2]) },
    };
  return undefined;
}

/** Sources of a Planner proposal in the reader's language. */
export function sourceLabels(
  sources: Provenance["sources"] | undefined,
  rt: RefText,
): { label: string }[] {
  return (sources ?? []).map((s) => ({ label: rt(s.ref ?? legacyRef(s.label), s.label) }));
}
