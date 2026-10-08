import "server-only";
import type { MessageKey } from "@forgecy/i18n";
import type { z } from "zod";
import { vmsg } from "./i18n";
import { checkPassword, passwordIssueRef } from "./password";

/** Zod `superRefine` body: reports a password problem (`validation.*` key plus values) on the password field. */
export function refinePassword(data: { password: string }, ctx: z.RefinementCtx): void {
  const issue = checkPassword(data.password);
  if (!issue) return;
  const ref = passwordIssueRef(issue);
  ctx.addIssue({ code: "custom", path: ["password"], message: vmsg(ref.key as MessageKey, ref.values) });
}
