import { readFileSync } from "node:fs";
import path from "node:path";
import { templateManifestSchema } from "@forgecy/carousel";
import { compareVersions } from "@forgecy/carousel/catalog";
import { renameTemplateRow } from "@forgecy/client-transfer/templates";
import { describe, expect, it } from "vitest";
import { parseRow } from "../src/carousels/templates";

const manifest = JSON.parse(
  readFileSync(
    path.resolve(
      import.meta.dirname,
      "../../../templates/carousels/editorial-ig-4x5/template.json",
    ),
    "utf8",
  ),
) as { id: string; version: string };

/** A templates row the way the importer leaves a package's template. */
const row = {
  id: "00000000-0000-4000-8000-000000000001",
  key: manifest.id,
  version: manifest.version,
  name: "Editorial",
  kind: "carousel",
  channel: "instagram",
  format: "instagram_4_5",
  origin: "agency",
  clientId: "00000000-0000-4000-8000-000000000002",
  status: "published",
  manifest,
  packageKey: "k",
  packageSha256: "s",
  packageSize: 1,
  validation: {},
  versionNotes: null,
  createdBy: null,
  submittedAt: null,
  publishedAt: null,
  publishedBy: null,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Parameters<typeof parseRow>[0];

describe("a template imported under a renamed version", () => {
  const renamed = renameTemplateRow(
    row as unknown as Record<string, unknown>,
    `${manifest.version}-import.1`,
  );

  it("is still read by the catalog (the real parseRow), under the new version", () => {
    expect(parseRow(row)).not.toBeNull();
    const usable = parseRow(renamed as unknown as typeof row);
    expect(usable).not.toBeNull();
    expect(usable!.version).toBe(`${manifest.version}-import.1`);
    expect(usable!.key).toBe(manifest.id);
  });
  it("would be unreadable if the manifest carried the renamed version: the rule stays strict", () => {
    const broken = { ...row, manifest: { ...manifest, version: `${manifest.version}-import.1` } };
    expect(templateManifestSchema.safeParse(broken.manifest).success).toBe(false);
    expect(parseRow(broken)).toBeNull();
  });
  it("sorts just below the release it was copied from", () => {
    expect(compareVersions(`${manifest.version}-import.1`, manifest.version)).toBeLessThan(0);
  });
});
