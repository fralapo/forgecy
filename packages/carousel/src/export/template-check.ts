import type { Browser } from "playwright-core";
import { NEUTRAL_BRAND } from "../brand";
import type { TemplatePackage } from "../package";
import { renderSlideHtml } from "../renderer";
import { longTextSlide, sampleSlide } from "../slide-schema";
import { effectiveSafeZone } from "../template-schema";
import type { ValidationReport } from "../validate";
import { type CaptureInput, captureSlides } from "./capture";
import { slotLimits } from "./carousel";

/**
 * Render checks of the Template editor: every layout with its sample data ("Render di
 * prova") and with every text slot at its limit ("Testo lungo: nessun overflow").
 */
export async function renderCheckTemplate(
  browser: Browser,
  pkg: TemplatePackage,
  report: ValidationReport,
): Promise<ValidationReport> {
  const m = pkg.manifest;
  const issues = [...report.issues];
  const checks = [...report.checks];
  const build = (long: boolean): CaptureInput[] =>
    m.layouts.map((layout, i) => ({
      rendered: renderSlideHtml({
        pkg,
        slide: long ? longTextSlide(layout) : sampleSlide(layout),
        index: i,
        total: m.layouts.length,
        brand: NEUTRAL_BRAND,
      }),
      safeZone: effectiveSafeZone(m, layout),
      limits: slotLimits(layout),
    }));

  let renderErrors = 0;
  try {
    const sample = await captureSlides(browser, build(false));
    for (const [i, c] of sample.entries())
      for (const issue of c.issues) {
        renderErrors++;
        issues.push({
          code: "TEMPLATE-INVALID",
          check: "render",
          file: m.layouts[i]!.file,
          layout: m.layouts[i]!.id,
          message: `esempio: ${issue.message}`,
        });
      }
  } catch (err) {
    renderErrors++;
    issues.push({
      code: "TEMPLATE-INVALID",
      check: "render",
      message: `render di prova fallito: ${(err as Error).message}`,
    });
  }
  checks.push({
    id: "render",
    label: renderErrors
      ? `Render di prova: ${renderErrors} problemi`
      : `Render di prova: ${m.layouts.length} layout senza errori`,
    status: renderErrors ? "error" : "ok",
  });

  let overflow = 0;
  if (!renderErrors) {
    const long = await captureSlides(browser, build(true));
    for (const [i, c] of long.entries())
      for (const issue of c.issues)
        if (issue.kind !== "low_resolution" && issue.kind !== "image_missing") {
          overflow++;
          issues.push({
            code: "TEMPLATE-INVALID",
            check: "overflow",
            file: m.layouts[i]!.file,
            layout: m.layouts[i]!.id,
            message: `testo lungo: ${issue.message}`,
          });
        }
  }
  checks.push({
    id: "overflow",
    label: renderErrors
      ? "Testo lungo: non verificato"
      : overflow
        ? `Testo lungo: ${overflow} overflow`
        : "Testo lungo: nessun overflow",
    status: renderErrors ? "skipped" : overflow ? "error" : "ok",
  });
  return { ...report, ok: !issues.length, issues, checks };
}
