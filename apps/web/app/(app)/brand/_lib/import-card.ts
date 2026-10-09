import type { LatestAutoImport } from "@forgecy/brand";
import type { MessageRef } from "@forgecy/core";

/**
 * What the "Imported automatically" card says besides its first line: that a person undid the
 * import (then nothing else applies), or how many items wait for a review.
 */
export function importNotes(latest: Pick<LatestAutoImport, "number" | "needsReview" | "undone">): {
  undone: MessageRef | null;
  kept: MessageRef | null;
} {
  if (latest.undone)
    return {
      undone: {
        key: "brand.overview.importUndone",
        values: { number: latest.number, by: latest.undone.by, restores: latest.undone.restores },
      },
      kept: null,
    };
  return {
    undone: null,
    kept: latest.needsReview
      ? { key: "brand.overview.importedKept", values: { count: latest.needsReview } }
      : null,
  };
}
