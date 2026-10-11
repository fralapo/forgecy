import { describe, expect, it } from "vitest";
import {
  checkInterfaceLabels,
  imageSlotOrientation,
  localizeManifest,
  slotDisplayName,
} from "../src/interface-labels";
import { packageFromFiles } from "../src/package";
import { templateManifestSchema } from "../src/template-schema";
import { validateTemplatePackage } from "../src/validate";
import { loadRepoTemplate, miniPackage } from "./helpers";

const enc = new TextEncoder();
const withInterface = (files: Record<string, string>) =>
  miniPackage({
    extra: Object.fromEntries(Object.entries(files).map(([p, json]) => [p, enc.encode(json)])),
  });

describe("template interface labels", () => {
  const files = withInterface({
    "interface/it.json": JSON.stringify({
      name: "Prova",
      layouts: { only: { name: "Unico", slots: { title: "Titolo" } } },
    }),
  });

  it("reads interface/<code>.json into the manifest and localizes with English fallback", () => {
    const pkg = packageFromFiles(files);
    expect(pkg.manifest.translations?.it?.name).toBe("Prova");
    const it = localizeManifest(pkg.manifest, "it");
    expect(it.name).toBe("Prova");
    expect(it.description).toBe(pkg.manifest.description);
    const layout = it.layouts.find((l) => l.id === "only")!;
    expect(layout.name).toBe("Unico");
    expect(layout.slots.find((s) => s.name === "title")?.label).toBe("Titolo");
    const items = layout.slots.find((s) => s.name === "items");
    const original = pkg.manifest.layouts[0]!.slots.find((s) => s.name === "items");
    expect(items?.label).toBe(original?.label);
    expect(localizeManifest(pkg.manifest, "en")).toBe(pkg.manifest);
  });

  it("keeps translations through validation and a stored manifest", () => {
    const report = validateTemplatePackage(files);
    const stored = JSON.parse(JSON.stringify(report.manifest));
    expect(templateManifestSchema.parse(stored).translations?.it?.layouts?.only?.name).toBe(
      "Unico",
    );
  });

  it("reports unreadable files and unknown layouts or slots", () => {
    const pkg = packageFromFiles(
      withInterface({
        "interface/it.json": JSON.stringify({ layouts: { nope: {}, only: { slots: { x: "X" } } } }),
        "interface/xx.json": "{}",
      }),
    );
    expect(checkInterfaceLabels(pkg)).toEqual([
      { path: "interface/it.json", message: 'unknown layout "nope"' },
      { path: "interface/it.json", message: 'unknown slot "x" in layout "only"' },
      { path: "interface/xx.json", message: '"xx" is not a supported language' },
    ]);
  });

  it.each([
    "carousels/editorial-fb-4x5",
    "carousels/editorial-ig-1x1",
    "carousels/editorial-ig-4x5",
    "carousels/editorial-linkedin",
    "carousels/editorial-stories-9x16",
    "carousels/editorial-tiktok-photo",
    "reports/brand-book-a4",
    "reports/report-audit-a4",
  ])("%s names every layout and slot in Italian", async (folder) => {
    const repo = await loadRepoTemplate(folder);
    expect(checkInterfaceLabels(repo)).toEqual([]);
    const it = repo.manifest.translations?.it;
    expect(it?.name && it.description && it.notes).toBeTruthy();
    for (const layout of repo.manifest.layouts) {
      expect(it?.layouts?.[layout.id]?.name, layout.id).toBeTruthy();
      for (const slot of layout.slots)
        expect(
          it?.layouts?.[layout.id]?.slots?.[slot.name],
          `${layout.id}.${slot.name}`,
        ).toBeTruthy();
    }
  });
});

describe("slotDisplayName", () => {
  const pkg = packageFromFiles(
    withInterface({
      "interface/it.json": JSON.stringify({
        layouts: { only: { slots: { title: "Titolo" } } },
      }),
    }),
  );
  it("uses the localized slot label and falls back to the key", () => {
    const it = localizeManifest(pkg.manifest, "it");
    expect(slotDisplayName(it, "only", "title")).toBe("Titolo");
    expect(slotDisplayName(it, "only", "nope")).toBe("nope");
    expect(slotDisplayName(it, "gone", "title")).toBe("title");
    expect(slotDisplayName(null, null, "title")).toBe("title");
  });
});

describe("imageSlotOrientation", () => {
  const canvas = { width: 1080, height: 1350 };
  it("follows the slot minimum size, then the canvas", () => {
    expect(imageSlotOrientation({ minWidth: 1200, minHeight: 800 }, canvas)).toBe("landscape");
    expect(imageSlotOrientation({ minWidth: 800, minHeight: 1200 }, canvas)).toBe("portrait");
    expect(imageSlotOrientation({ minWidth: 900, minHeight: 900 }, canvas)).toBe("square");
    expect(imageSlotOrientation({}, canvas)).toBe("portrait");
    expect(imageSlotOrientation({ minWidth: 500 }, { width: 1080, height: 1080 })).toBe("square");
    expect(imageSlotOrientation({}, { width: 1920, height: 1080 })).toBe("landscape");
  });
});
