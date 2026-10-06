import { englishMessage, type MessageKey, type MessageValues, messageRef } from "@forgecy/i18n";
import type { Browser } from "playwright-core";
import { NEUTRAL_BRAND } from "../brand";
import type { TemplatePackage } from "../package";
import { renderSlideHtml } from "../renderer";
import { longTextSlide, sampleSlide } from "../slide-schema";
import { effectiveSafeZone } from "../template-schema";
import type { ValidationReport } from "../validate";
import { type CaptureInput, captureSlides } from "./capture";
import { slotLimits } from "./carousel";

/** English text plus reference of a message, for issues (`message`) and checks (`label`). */
function msg(key: MessageKey, values?: MessageValues) {
  return { text: englishMessage(key, values), ref: messageRef(key, values) };
}

/**
 * Render checks of the Template editor: every layout with its sample data ("Test
 * render") and with every text slot at its limit ("Long text: no overflow").
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
        const { text, ref } = msg("templates.issues.renderSample", { detail: issue.message });
        issues.push({
          code: "TEMPLATE-INVALID",
          check: "render",
          file: m.layouts[i]!.file,
          layout: m.layouts[i]!.id,
          message: text,
          ref,
        });
      }
  } catch (err) {
    renderErrors++;
    const { text, ref } = msg("templates.issues.renderFailed", { detail: (err as Error).message });
    issues.push({ code: "TEMPLATE-INVALID", check: "render", message: text, ref });
  }
  const render = renderErrors
    ? msg("templates.checks.renderProblems", { count: renderErrors })
    : msg("templates.checks.renderOk", { count: m.layouts.length });
  checks.push({
    id: "render",
    label: render.text,
    status: renderErrors ? "error" : "ok",
    ref: render.ref,
  });

  let overflow = 0;
  if (!renderErrors) {
    const long = await captureSlides(browser, build(true));
    for (const [i, c] of long.entries())
      for (const issue of c.issues)
        if (issue.kind !== "low_resolution" && issue.kind !== "image_missing") {
          overflow++;
          const { text, ref } = msg("templates.issues.longText", { detail: issue.message });
          issues.push({
            code: "TEMPLATE-INVALID",
            check: "overflow",
            file: m.layouts[i]!.file,
            layout: m.layouts[i]!.id,
            message: text,
            ref,
          });
        }
  }
  const long = renderErrors
    ? msg("templates.checks.overflowNotChecked")
    : overflow
      ? msg("templates.checks.overflowFound", { count: overflow })
      : msg("templates.checks.overflowNone");
  checks.push({
    id: "overflow",
    label: long.text,
    status: renderErrors ? "skipped" : overflow ? "error" : "ok",
    ref: long.ref,
  });
  return { ...report, ok: !issues.length, issues, checks };
}
