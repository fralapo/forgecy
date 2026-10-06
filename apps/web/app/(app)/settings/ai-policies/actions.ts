"use server";

import {
  budgetPercent,
  getBudgetOverview,
  restrictableProviders,
  setApprovedProviders,
  setDefaultAiPolicy,
  setMonthlyBudget,
} from "@forgecy/ai";
import { setProspectPolicy } from "@forgecy/audit";
import { aiPolicies, PermissionDeniedError, type AiPolicy, type ProviderId } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { auditDeps } from "@/app/(app)/audit/_lib/server";
import { requireUser } from "@/lib/session";
import { deniedResult, type AdminActionResult } from "../_lib/admin-action";

const PATH = "/settings/ai-policies";

const policySchema = z.enum(aiPolicies);

export async function setDefaultPolicyAction(policy: AiPolicy): Promise<AdminActionResult> {
  const user = await requireUser();
  const t = await getTranslations("admin.aiPolicies");
  const parsed = policySchema.safeParse(policy);
  if (!parsed.success) return { ok: false, error: t("default.label"), code: "INPUT-INVALID" };
  try {
    await setDefaultAiPolicy(getDb(), user.actor, parsed.data);
  } catch (err) {
    if (err instanceof PermissionDeniedError) return deniedResult();
    throw err;
  }
  revalidatePath(PATH);
  return { ok: true, message: t("default.saved") };
}

export async function setClientPolicyAction(
  clientId: string,
  policy: AiPolicy,
): Promise<AdminActionResult> {
  const user = await requireUser();
  const t = await getTranslations("admin.aiPolicies.clients");
  const parsed = z.object({ clientId: z.uuid(), policy: policySchema }).safeParse({
    clientId,
    policy,
  });
  if (!parsed.success) return { ok: false, error: t("policy"), code: "INPUT-INVALID" };
  try {
    const { cancelledJobs } = await setProspectPolicy(
      await auditDeps(),
      user.actor,
      parsed.data.clientId,
      parsed.data.policy,
    );
    revalidatePath(PATH);
    return {
      ok: true,
      message: cancelledJobs ? t("changedCancelled", { count: cancelledJobs }) : t("changed"),
    };
  } catch (err) {
    if (err instanceof PermissionDeniedError) return deniedResult();
    throw err;
  }
}

/** Dollars with at most two decimals; empty removes the limit. */
const amountSchema = z
  .string()
  .trim()
  .regex(/^(\d+([.,]\d{1,2})?)?$/)
  .transform((v) => (v === "" ? null : Math.round(Number(v.replace(",", ".")) * 100)))
  .refine((v) => v === null || (v > 0 && v <= 100_000_000));

export async function setBudgetAction(
  clientId: string | null,
  amount: string,
): Promise<AdminActionResult> {
  const user = await requireUser();
  const t = await getTranslations("admin.aiPolicies.budget");
  const parsed = amountSchema.safeParse(amount);
  if (!parsed.success) return { ok: false, error: t("invalid"), code: "INPUT-INVALID" };
  if (clientId !== null && !z.uuid().safeParse(clientId).success)
    return { ok: false, error: t("invalid"), code: "INPUT-INVALID" };
  const db = getDb();
  try {
    await setMonthlyBudget(
      db,
      user.actor,
      clientId ? { scope: "client", clientId } : { scope: "agency" },
      parsed.data,
    );
  } catch (err) {
    if (err instanceof PermissionDeniedError) return deniedResult();
    throw err;
  }
  revalidatePath(PATH);
  if (parsed.data === null) return { ok: true, message: t("removed") };
  const overview = await getBudgetOverview(db);
  const line = clientId ? overview.clients.find((c) => c.clientId === clientId) : overview.agency;
  const percent = line ? budgetPercent(line) : null;
  return {
    ok: true,
    message: percent !== null && percent >= 100 ? t("alreadyExceeded") : t("saved"),
  };
}

export async function setApprovedProvidersAction(
  clientId: string,
  providers: string[],
): Promise<AdminActionResult> {
  const user = await requireUser();
  const t = await getTranslations("admin.aiPolicies.clients");
  const parsed = z
    .object({
      clientId: z.uuid(),
      providers: z.array(z.enum(restrictableProviders as [ProviderId, ...ProviderId[]])).min(1),
    })
    .safeParse({ clientId, providers });
  if (!parsed.success) return { ok: false, error: t("providersNone"), code: "INPUT-INVALID" };
  try {
    await setApprovedProviders(getDb(), user.actor, parsed.data.clientId, parsed.data.providers);
  } catch (err) {
    if (err instanceof PermissionDeniedError) return deniedResult();
    throw err;
  }
  revalidatePath(PATH);
  return { ok: true, message: t("providersSaved") };
}
