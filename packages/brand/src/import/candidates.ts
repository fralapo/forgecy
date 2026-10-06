/** Turns extracted candidates into proposals, skipping duplicates and values already in the draft. */
import { ForgecyError, type Actor } from "@forgecy/core";
import type { Database } from "@forgecy/db";
import { BRAND_ANALYST_PROMPT_VERSION } from "./analyst";
import { proposeChange, type ProposeInput } from "../service";
import { hexToDtcg, normalizeHex, referenceColors, tokenNameFrom } from "../tokens";
import { getDraftTokens } from "./draft-tokens";
import type { ProposalOp } from "../proposals";

export interface CandidateProposal {
  /** "color" candidates get their token path assigned here. */
  kind?: "color";
  path: string;
  op: ProposalOp;
  value: unknown;
  rationale?: string;
  modelConfidence?: number;
  evidence: { locator?: string; quote?: string };
  /** provider/model, for the activity log. */
  agentModel?: string;
}

const COLOR_WORDS =
  /\b(blu|azzurro|rosso|verde|giallo|arancio(?:ne)?|viola|rosa|nero|bianco|grigio|oro|argento|blue|red|green|yellow|orange|purple|pink|black|white|gray|grey|gold|silver|primario|secondario|primary|secondary|accent[oe]?)\b/i;

/** Name of a color from the words right before its value ("Crema #F5EBDC" → "Crema"). */
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

export async function addSourceProposals(
  db: Database,
  agent: Actor,
  clientId: string,
  sourceId: string,
  candidates: readonly CandidateProposal[],
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
      let name = tokenNameFrom(colorName(v.name, hex, `colore-${n}`), `colore-${n}`);
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
        title: `Colore ${name} ${hex}`,
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
        ...(c.modelConfidence !== undefined ? { modelConfidence: c.modelConfidence } : {}),
        evidence: [
          {
            sourceId,
            ...(c.evidence.locator ? { locator: c.evidence.locator.slice(0, 120) } : {}),
            ...(c.evidence.quote ? { quote: c.evidence.quote.slice(0, 300) } : {}),
          },
        ],
        auditMeta: { promptVersion: BRAND_ANALYST_PROMPT_VERSION, model: c.agentModel ?? null },
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
