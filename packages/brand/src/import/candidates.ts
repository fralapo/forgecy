/** Turns extracted candidates into proposals, skipping duplicates and values already in the draft. */
import { ForgecyError, type Actor, type MessageRef } from "@forgecy/core";
import type { SiteProbe } from "@forgecy/audit";
import { englishMessage, messageRef, type MessageKey, type MessageValues } from "@forgecy/i18n";
import type { Database } from "@forgecy/db";
import { BRAND_ANALYST_PROMPT_VERSION, pagePriority } from "./analyst";
import { matchField } from "../fields";
import { cleanFamily, knownColors, knownFonts, SITE_LOCATORS } from "./site-colors";
import { proposeChange, type ProposeInput } from "../service";
import { hexToDtcg, normalizeHex, referenceColors, tokenNameFrom } from "../tokens";
import { getDraftTokens } from "./draft-tokens";
import type { ProposalOp } from "../proposals";

export interface CandidateProposal {
  /** "color" candidates get their token path assigned here; "logo" is the file the crawl itself stored. */
  kind?: "color" | "logo";
  /** The color's name is final (read from the site or chosen by the analyst), not to be guessed from context. */
  named?: boolean;
  path: string;
  op: ProposalOp;
  value: unknown;
  rationale?: string;
  /** Set when the rationale is written by code, to show it in the reader's language. */
  rationaleRef?: MessageRef;
  modelConfidence?: number;
  evidence: { locator?: string; quote?: string };
  /** provider/model, for the activity log. */
  agentModel?: string;
  /** Order of the analyst request that proposed it (0 = the one with the home page). */
  chunk?: number;
}

/** A `set` on a field that holds one value (one-liner, positioning, voice...). */
const isSingleValue = (c: CandidateProposal) =>
  !c.kind && c.op === "set" && matchField(c.path)?.field.shape === "sourced";

/**
 * One value per single-value field for the whole run, so a run never contests itself: the first
 * request (home and about pages) wins, then the model's surer item, then the home/about page.
 */
export function keepBestSingleValues(
  candidates: readonly CandidateProposal[],
): CandidateProposal[] {
  const rank = (c: CandidateProposal) => [
    c.chunk ?? 0,
    -(c.modelConfidence ?? 0),
    pagePriority(c.evidence.locator ?? ""),
  ];
  const before = (a: number[], b: number[]) => {
    const i = a.findIndex((v, k) => v !== b[k]);
    return i >= 0 && a[i]! < b[i]!;
  };
  const best = new Map<string, CandidateProposal>();
  for (const c of candidates) {
    if (!isSingleValue(c)) continue;
    const kept = best.get(c.path);
    if (!kept || before(rank(c), rank(kept))) best.set(c.path, c);
  }
  return candidates.filter((c) => !isSingleValue(c) || best.get(c.path) === c);
}

export function rationale(
  key: MessageKey & `brand.import.rationale.${string}`,
  values?: MessageValues,
) {
  return { rationale: englishMessage(key, values), rationaleRef: messageRef(key, values) };
}

/** Most colors proposed straight from the site's styles; the analyst may name more of the known ones. */
const MAX_SITE_COLORS = 6;
const MAX_SITE_FONTS = 3;

/** The logo the crawl downloaded and registered as a source; the file itself is the evidence. */
export function logoCandidate(sourceId: string, logo: { url: string }): CandidateProposal {
  return {
    kind: "logo",
    path: "/document/visual/logo/variants",
    op: "append",
    value: { role: "logo_primary", sourceId, background: "any" },
    ...rationale("brand.import.rationale.logoSite"),
    evidence: { locator: logo.url },
  };
}

/**
 * Colors, fonts and the harvested logo from the site, as proposals. Nothing here comes from a model.
 */
export function visualCandidates(
  visual: SiteProbe,
  logo?: { sourceId: string; image: { url: string } },
): CandidateProposal[] {
  const colors: CandidateProposal[] = knownColors(visual)
    .slice(0, MAX_SITE_COLORS)
    .map((c) => ({
      kind: "color",
      named: true,
      path: "",
      op: "set",
      value: { name: c.name, hex: c.hex, usage: "" },
      ...rationale("brand.import.rationale.siteColor"),
      evidence: { locator: c.locator },
    }));
  const fonts: CandidateProposal[] = knownFonts(visual)
    .slice(0, MAX_SITE_FONTS)
    .map((f) => ({
      path: "/document/visual/typography",
      op: "append",
      value: {
        role: f.roles.includes("headings") ? "display" : "body",
        family: f.family,
        weights: [],
        licenseStatus: "to_verify",
      },
      ...rationale("brand.import.rationale.siteFont"),
      evidence: { locator: SITE_LOCATORS.fonts },
    }));
  return [...colors, ...fonts, ...(logo ? [logoCandidate(logo.sourceId, logo.image)] : [])];
}

// Matches Italian and English color words in client documents.
const COLOR_WORDS =
  /\b(blu|azzurro|rosso|verde|giallo|arancio(?:ne)?|viola|rosa|nero|bianco|grigio|oro|argento|blue|red|green|yellow|orange|purple|pink|black|white|gray|grey|gold|silver|primario|secondario|primary|secondary|accent[oe]?)\b/i;

/** Name of a color from the words right before its value ("Cream #F5EBDC" → "Cream"). */
export function colorName(context: string, hex: string, fallback: string): string {
  const full = hex.replace(/^#/, "");
  // The text may use the 3-digit form (#FFF) of a 6-digit value.
  const short = /^(.)\1(.)\2(.)\3$/.test(full) ? `|${full[0]}${full[2]}${full[4]}` : "";
  const re = new RegExp(`#(?:${full}${short})(?![0-9a-z])`, "i");
  const at = context.search(re);
  if (at > 0) {
    const clause =
      context
        .slice(0, at)
        .split(/[.,;:()\n]|#[0-9a-f]{3,6}/i)
        .pop() ?? "";
    const words = clause
      .replace(/[-–]\s*$/, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(-3);
    const named = words.join(" ");
    if (named && named.length <= 30 && /[A-Za-zÀ-ÿ]/.test(named)) return named;
  }
  const word = COLOR_WORDS.exec(context)?.[1];
  return word ?? fallback;
}

/**
 * One proposal per color and font family. The analyst's name and usage fill a color the site
 * already gave bare; a font keeps its role from the computed styles.
 */
export function mergeSiteItems(candidates: readonly CandidateProposal[]): CandidateProposal[] {
  const colors = new Map<string, CandidateProposal>();
  const families = new Set<string>();
  const axes = new Set<string>();
  const out: CandidateProposal[] = [];
  for (const c of candidates) {
    if (c.kind === "color") {
      const v = c.value as { name: string; hex: string; usage?: string };
      const key = normalizeHex(v.hex) ?? v.hex;
      const first = colors.get(key);
      if (!first) {
        colors.set(key, c);
        out.push(c);
      } else {
        const f = first.value as { usage?: string };
        if (!f.usage)
          first.value = { ...(first.value as object), name: v.name, usage: v.usage ?? "" };
      }
    } else if (c.path === "/document/visual/typography") {
      const family = cleanFamily((c.value as { family: string }).family);
      if (families.has(family)) continue;
      families.add(family);
      out.push(c);
    } else if (c.path === "/document/verbal/toneAxes") {
      // The prompt asks for one axis per concept; this is the guarantee.
      const axis = (c.value as { axis: string }).axis;
      if (axes.has(axis)) continue;
      axes.add(axis);
      out.push(c);
    } else out.push(c);
  }
  return out;
}

export async function addSourceProposals(
  db: Database,
  agent: Actor,
  clientId: string,
  sourceId: string,
  candidates: readonly CandidateProposal[],
  promptVersion: string = BRAND_ANALYST_PROMPT_VERSION,
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  const seen = new Set<string>();
  const tokens = await getDraftTokens(db, clientId);
  const existingHex = new Set(referenceColors(tokens).map((c) => c.hex));
  const usedNames = new Set(referenceColors(tokens).map((c) => c.name));
  let n = usedNames.size;

  for (const c of candidates) {
    let input: ProposeInput;
    if (c.kind === "color") {
      const v = c.value as { name: string; hex: string; usage?: string };
      const hex = normalizeHex(v.hex);
      if (!hex || existingHex.has(hex) || seen.has(`color:${hex}`)) {
        skipped++;
        continue;
      }
      seen.add(`color:${hex}`);
      existingHex.add(hex);
      n++;
      let name = tokenNameFrom(
        c.named ? v.name : colorName(v.name, hex, `color-${n}`),
        `color-${n}`,
      );
      while (usedNames.has(name)) name = `${name}-${n}`;
      usedNames.add(name);
      input = {
        clientId,
        path: `/tokens/color/reference/${name}`,
        op: "set",
        value: {
          $value: hexToDtcg(hex),
          ...(v.usage ? { $description: v.usage.slice(0, 400) } : {}),
        },
        title: englishMessage("brand.import.colorTitle", { name, hex }),
        titleRef: messageRef("brand.import.colorTitle", { name, hex }),
      };
    } else {
      const key = `${c.path}:${JSON.stringify(c.value)}`;
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      input = { clientId, path: c.path, op: c.op, value: c.value };
    }
    try {
      await proposeChange(db, agent, {
        ...input,
        ...(c.rationale ? { rationale: c.rationale } : {}),
        ...(c.rationaleRef ? { rationaleRef: c.rationaleRef } : {}),
        ...(c.modelConfidence !== undefined ? { modelConfidence: c.modelConfidence } : {}),
        evidence: [
          {
            sourceId,
            ...(c.evidence.locator ? { locator: c.evidence.locator.slice(0, 120) } : {}),
            ...(c.evidence.quote ? { quote: c.evidence.quote.slice(0, 300) } : {}),
          },
        ],
        auditMeta: { promptVersion, model: c.agentModel ?? null },
      });
      created++;
    } catch (err) {
      if (err instanceof ForgecyError && (err.code === "validation" || err.code === "conflict"))
        skipped++;
      else throw err;
    }
  }
  return { created, skipped };
}
