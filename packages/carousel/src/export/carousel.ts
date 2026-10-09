import { DEFAULT_LOCALE, type Locale } from "@forgecy/core";
import { englishMessage, getTranslator, intlLocale, messageRef } from "@forgecy/i18n";
import type { Browser } from "playwright-core";
import type { BrandTheme } from "../brand";
import { exportFileNames } from "../filenames";
import { pdfPageSize } from "../formats";
import type { ExportOutput } from "../jobs";
import type { TemplatePackage } from "../package";
import { type RenderOptions, type ResolvedAssets, renderSlideHtml } from "../renderer";
import type { Slide } from "../slide-schema";
import { effectiveSafeZone, findLayout, type LayoutDef } from "../template-schema";
import {
  type CarouselTexts,
  type ExportMetadata,
  captionText,
  slidesJson,
  slidesMarkdown,
} from "../texts";
import { type CaptureInput, type RenderIssue, captureSlides } from "./capture";
import { buildZip, pngsToPdf, zipDate } from "./compose";

export interface ExportFileData {
  name: string;
  kind: "png" | "pdf" | "zip";
  contentType: string;
  data: Uint8Array;
}

export interface ExportCarouselInput {
  pkg: TemplatePackage;
  slides: Slide[];
  brand: BrandTheme;
  assets?: ResolvedAssets;
  outputs: ExportOutput[];
  meta: ExportMetadata;
  texts?: CarouselTexts;
  draft?: boolean;
  /** Language of the deliverable: template labels, watermark, PDF and page language. */
  language?: Locale;
  /** Called with 0–100 as the export advances. */
  onProgress?: (percent: number) => Promise<void> | void;
  /** Checked between slides: stop early when it returns true. */
  isCancelled?: () => Promise<boolean>;
}

export interface ExportCarouselResult {
  files: ExportFileData[];
  issues: RenderIssue[];
  warnings: string[];
}

export class ExportCancelledError extends Error {
  readonly ref = messageRef("jobs.errors.exportCancelled");
  constructor() {
    super(englishMessage("jobs.errors.exportCancelled"));
    this.name = "ExportCancelledError";
  }
}

export function slotLimits(layout: LayoutDef | undefined): CaptureInput["limits"] {
  const limits: NonNullable<CaptureInput["limits"]> = {};
  for (const s of layout?.slots ?? []) {
    if (s.type === "text") limits[s.name] = { ...(s.maxLines ? { maxLines: s.maxLines } : {}) };
    if (s.type === "image")
      limits[s.name] = {
        ...(s.minWidth ? { minWidth: s.minWidth } : {}),
        ...(s.minHeight ? { minHeight: s.minHeight } : {}),
      };
  }
  return limits;
}

/** Render every slide, then compose the requested files. Storage-agnostic: the caller saves them. */
export async function exportCarousel(
  browser: Browser,
  input: ExportCarouselInput,
): Promise<ExportCarouselResult> {
  const { pkg, slides, brand, meta, draft = false, language = DEFAULT_LOCALE } = input;
  const m = pkg.manifest;
  const texts = input.texts ?? {};
  const progress = input.onProgress ?? (() => undefined);
  const options: RenderOptions = draft
    ? { watermark: getTranslator(language, "deliverable")("draftWatermark") }
    : {};
  const warnings: string[] = [];

  await progress(5);
  const captureInputs: CaptureInput[] = slides.map((slide, index) => {
    const layout = findLayout(m, slide.layout);
    const rendered = renderSlideHtml({
      pkg,
      slide,
      index,
      total: slides.length,
      brand,
      ...(input.assets ? { assets: input.assets } : {}),
      options,
      language,
    });
    warnings.push(...rendered.warnings.map((w) => `Slide ${index + 1}: ${w}`));
    return { rendered, safeZone: effectiveSafeZone(m, layout), limits: slotLimits(layout) };
  });

  const captures = await captureSlides(
    browser,
    captureInputs,
    async (i) => {
      if (await input.isCancelled?.()) throw new ExportCancelledError();
      await progress(10 + Math.round(((i + 1) / slides.length) * 70));
    },
    intlLocale(language),
  );
  const pngs = captures.map((c) => c.png);
  const names = exportFileNames({
    client: meta.client,
    content: meta.content,
    version: meta.version,
    format: m.format,
    slides: slides.length,
    draft,
  });
  const files: ExportFileData[] = [];
  const wantZip = input.outputs.includes("zip");

  if (input.outputs.includes("png") || wantZip)
    pngs.forEach((data, i) =>
      files.push({ name: names.png[i]!, kind: "png", contentType: "image/png", data }),
    );

  let pdf: Uint8Array | undefined;
  if (input.outputs.includes("pdf") || wantZip) {
    await progress(85);
    const page = pdfPageSize(m.format);
    pdf = await pngsToPdf(pngs, page.width, page.height, {
      language: intlLocale(language),
      title: `${meta.content} · v${meta.version}`,
      author: meta.client,
      subject: `${m.name} ${m.version} · ${m.format}`,
      keywords: [
        `template:${m.id}@${m.version}`,
        ...((meta.brandIdentityVersion ?? brand.version)
          ? [`brand-identity:${meta.brandIdentityVersion ?? brand.version}`]
          : []),
        ...(meta.models ?? []).map((x) => `model:${x}`),
      ],
      date: meta.approvedAt ? new Date(meta.approvedAt) : new Date(Date.UTC(2000, 0, 1)),
    });
    files.push({ name: names.pdf, kind: "pdf", contentType: "application/pdf", data: pdf });
  }

  if (wantZip) {
    await progress(95);
    const enc = new TextEncoder();
    const entries = [
      ...files.map((f) => ({ name: f.name, data: f.data })),
      { name: "caption.txt", data: enc.encode(captionText(texts)) },
      { name: "texts.md", data: enc.encode(slidesMarkdown(pkg, slides, meta, texts, language)) },
      { name: "slides.json", data: enc.encode(slidesJson(pkg, slides, meta, texts, brand)) },
    ];
    files.push({
      name: names.zip,
      kind: "zip",
      contentType: "application/zip",
      data: buildZip(entries, zipDate(meta.approvedAt)),
    });
  }

  await progress(100);
  return { files, issues: captures.flatMap((c) => c.issues), warnings };
}
