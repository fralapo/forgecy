import { describe, expect, it } from "vitest";
import { carouselExportPayloadSchema } from "../src/jobs";

describe("the template version of an export", () => {
  const version = carouselExportPayloadSchema.shape.templateVersion;
  it("holds a version an import renamed, however many times", () => {
    expect(version.safeParse("100.100.100-import.999").success).toBe(true);
    expect(version.safeParse("1.0.0-import.1").success).toBe(true);
  });
  it("is still bounded", () => {
    expect(version.safeParse("1".repeat(33)).success).toBe(false);
  });
});
