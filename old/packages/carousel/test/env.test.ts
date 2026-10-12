import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chromiumExecutable } from "../src/export/browser";
import { defaultTemplatesDir } from "../src/node";

afterEach(() => vi.unstubAllEnvs());

describe("environment-driven paths", () => {
  it("uses FORGECY_CHROMIUM_PATH only when the file exists", () => {
    vi.stubEnv("FORGECY_CHROMIUM_PATH", process.execPath);
    expect(chromiumExecutable()).toBe(process.execPath);
    vi.stubEnv("FORGECY_CHROMIUM_PATH", path.join(process.execPath, "missing"));
    expect(chromiumExecutable()).toBeUndefined();
    vi.stubEnv("FORGECY_CHROMIUM_PATH", "");
    expect(chromiumExecutable()).toBeUndefined();
  });

  it("honours FORGECY_TEMPLATES_DIR", () => {
    vi.stubEnv("FORGECY_TEMPLATES_DIR", "custom-templates");
    expect(defaultTemplatesDir()).toBe(path.resolve("custom-templates"));
  });
});
