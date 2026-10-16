import { createHash } from "node:crypto";
import type { ZodType } from "zod";

const CHECKPOINT_FINGERPRINT = "_forgecy_context_fingerprint";
export type MissionStageEvent = { agent: string; recipient: string; summary: string; result: unknown };

export function missionContextFingerprint(context: unknown): string {
  const serialized=JSON.stringify(context);
  if(serialized===undefined)throw new TypeError("Il contesto della missione non è serializzabile");
  return createHash("sha256").update(serialized).digest("hex");
}

export function saveMissionStageCheckpoint<T extends Record<string, unknown>>(
  result: T,
  fingerprint: string,
): T & { _forgecy_context_fingerprint: string } {
  return { ...result, [CHECKPOINT_FINGERPRINT]: fingerprint };
}

export function restoreMissionStageCheckpoint<T>(
  value: unknown,
  fingerprint: string,
  schema: ZodType<T>,
): T | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record[CHECKPOINT_FINGERPRINT] !== fingerprint) return null;
  const result = { ...record };
  delete result[CHECKPOINT_FINGERPRINT];
  const parsed = schema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

export function restoreMissionStageCheckpointFromEvents<T>(
  events: readonly MissionStageEvent[],
  stage: Pick<MissionStageEvent,"agent"|"recipient"|"summary">,
  fingerprint: string,
  schema: ZodType<T>,
): T | null {
  const event=events.find(candidate=>candidate.agent===stage.agent&&
    candidate.recipient===stage.recipient&&candidate.summary===stage.summary);
  return event?restoreMissionStageCheckpoint(event.result,fingerprint,schema):null;
}
