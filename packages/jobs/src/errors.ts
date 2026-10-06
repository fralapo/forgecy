import type { MessageRef } from "@forgecy/core";
import { UnrecoverableError } from "bullmq";

/**
 * Throw from a handler when a person must step in (bad input, policy block, missing
 * asset…). The job stops retrying and ends in `needs_attention` with this message.
 */
export class NeedsAttentionError extends Error {
  constructor(
    message: string,
    readonly details?: Record<string, unknown>,
    /** Translatable form of the message; build it with `messageRef` from @forgecy/i18n. */
    readonly ref?: MessageRef,
  ) {
    super(message);
    this.name = "NeedsAttentionError";
  }
}

export function isNeedsAttentionError(err: unknown): err is NeedsAttentionError {
  return (
    err instanceof NeedsAttentionError ||
    (err instanceof Error && err.name === "NeedsAttentionError")
  );
}

/** Throw to fail immediately without retries (status `failed`). Re-exported from BullMQ. */
export { UnrecoverableError };

export function isUnrecoverableError(err: unknown): boolean {
  return (
    err instanceof UnrecoverableError || (err instanceof Error && err.name === "UnrecoverableError")
  );
}

const MAX_ERROR_LENGTH = 2000;

/** Error text stored in jobs.error and shown in the UI. */
export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message || err.name : String(err);
  return msg.length > MAX_ERROR_LENGTH ? `${msg.slice(0, MAX_ERROR_LENGTH - 1)}…` : msg;
}
