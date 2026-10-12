/**
 * Render every layout of a template package to PNG, with sample and long texts, and
 * print validation and render issues. Usage:
 *   pnpm --filter @forgecy/carousel preview ../../templates/carousels/editorial-ig-4x5 /tmp/out
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  formatIssue,
  longTextSlide,
  NEUTRAL_BRAND,
  renderSlideHtml,
  sampleSlide,
  validateTemplatePackage,
} from "../src";
import { captureSlides, launchRenderBrowser, renderCheckTemplate } from "../src/export";
import { slotLimits } from "../src/export/carousel";
import { effectiveSafeZone } from "../src/template-schema";
import { readTemplateDir } from "../src/node";

const [dir, out = "preview-out"] = process.argv.slice(2);
if (!dir) throw new Error("Usage: preview <template-folder> [output-folder]");
const files = await readTemplateDir(path.resolve(dir));
const report = validateTemplatePackage(files);
if (!report.manifest) {
  console.error(report.issues.map(formatIssue).join("\n"));
  process.exit(1);
}
const pkg = { manifest: report.manifest, files };
const browser = await launchRenderBrowser();
try {
  const full = await renderCheckTemplate(browser, pkg, report);
  for (const c of full.checks) console.log(`${c.status.padEnd(7)} ${c.label}`);
  for (const i of full.issues) console.log(`  · ${formatIssue(i)}`);
  await mkdir(out, { recursive: true });
  for (const long of [false, true]) {
    const caps = await captureSlides(
      browser,
      pkg.manifest.layouts.map((layout, i) => ({
        rendered: renderSlideHtml({
          pkg,
          slide: long ? longTextSlide(layout) : sampleSlide(layout),
          index: i,
          total: pkg.manifest.layouts.length,
          brand: NEUTRAL_BRAND,
          options: long ? { showSafeZone: true } : {},
        }),
        safeZone: effectiveSafeZone(pkg.manifest, layout),
        limits: slotLimits(layout),
      })),
    );
    for (const [i, c] of caps.entries())
      await writeFile(
        path.join(
          out,
          `${String(i + 1).padStart(2, "0")}-${pkg.manifest.layouts[i]!.id}${long ? "-long" : ""}.png`,
        ),
        c.png,
      );
  }
  console.log(`PNG in ${path.resolve(out)}`);
} finally {
  await browser.close();
}
