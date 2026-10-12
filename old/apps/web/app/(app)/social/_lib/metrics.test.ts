import { createFormat } from "@forgecy/i18n";
import { describe, expect, it } from "vitest";
import { formatDelta, formatMetric } from "./metrics";

const en = createFormat("en");

describe("formatMetric", () => {
  it("writes shares as percent and rates as given", () => {
    expect(formatMetric(en, "reelShare", 0.25)).toBe("25%");
    expect(formatMetric(en, "engagementRatePct", 2.345)).toBe("2.35%");
  });
  it("rounds counts and decimals", () => {
    expect(formatMetric(en, "followers", 12000.4)).toBe("12,000");
    expect(formatMetric(en, "postsPerWeek", 3.46)).toBe("3.5");
  });
});

describe("formatDelta", () => {
  it("signs the difference and flags percentage points", () => {
    expect(formatDelta(en, "ctaShare", -0.1)).toEqual({ value: "-10", points: true });
    expect(formatDelta(en, "followers", 500)).toEqual({ value: "+500", points: false });
    expect(formatDelta(en, "followers", 0).value).toBe("0");
  });
});
