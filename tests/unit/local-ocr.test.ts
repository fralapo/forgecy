import test from "node:test";
import assert from "node:assert/strict";
import { selectOcrProvider, stablePaddleRelease } from "@/lib/local-ocr";

test("OCR auto mode uses local only when the parser exists and hardware recommends it", () => {
  assert.equal(selectOcrProvider("auto", false, "local"), "openrouter");
  assert.equal(selectOcrProvider("auto", true, "api"), "openrouter");
  assert.equal(selectOcrProvider("auto", true, "local"), "local");
  assert.equal(selectOcrProvider("local", false, "api"), "local");
  assert.equal(selectOcrProvider("openrouter", true, "local"), "openrouter");
});

test("PaddleOCR updater accepts only stable semantic release tags", () => {
  assert.equal(stablePaddleRelease({ tag_name: "v3.6.0", draft: false, prerelease: false }), "3.6.0");
  assert.equal(stablePaddleRelease({ tag_name: "3.6.0", draft: false, prerelease: false }), "3.6.0");
  assert.equal(stablePaddleRelease({ tag_name: "v3.7.0-rc1", draft: false, prerelease: false }), null);
  assert.equal(stablePaddleRelease({ tag_name: "v3.6.1", draft: false, prerelease: true }), null);
  assert.equal(stablePaddleRelease({ tag_name: "v3.6.0", draft: true, prerelease: false }), null);
  assert.equal(stablePaddleRelease("v3.6.0"), null);
});
