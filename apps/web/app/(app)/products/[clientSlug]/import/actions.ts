"use server";

import {
  cancelImport,
  columnMappingSchema,
  confirmMapping,
  importOptionsSchema,
  importAiSetup,
  loadCatalogClient,
  removeImportFile,
  rereadCsv,
  retryImport,
  setFileRoute,
  setImportOptions,
  startImport,
  type FileMeta,
} from "@forgecy/catalog";
import { importFileRoutes } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { refText } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import {
  actingUser,
  attempt,
  cancelImportJob,
  enqueueImportStep,
  getStorage,
} from "../../_lib/server";
import type { ActionResult } from "../../_lib/types";

const ids = z.object({ clientId: z.uuid(), importId: z.uuid() });

async function aiAvailable(clientId: string) {
  const client = await loadCatalogClient(getDb(), clientId);
  return importAiSetup(env, client.aiPolicy).available;
}

export async function setRouteAction(input: {
  clientId: string;
  importId: string;
  fileId: string;
  route: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  const data = ids.extend({ fileId: z.uuid(), route: z.enum(importFileRoutes) }).parse(input);
  return attempt(async () => {
    await setFileRoute(getDb(), actingUser(user), {
      ...data,
      aiAvailable: await aiAvailable(data.clientId),
    });
  });
}

export async function removeFileAction(input: {
  clientId: string;
  importId: string;
  fileId: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  const data = ids.extend({ fileId: z.uuid() }).parse(input);
  return attempt(() => removeImportFile(getDb(), actingUser(user), data));
}

export async function rereadCsvAction(input: {
  clientId: string;
  importId: string;
  fileId: string;
  encoding: string;
  delimiter: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  const data = ids
    .extend({
      fileId: z.uuid(),
      encoding: z.enum(["utf-8", "windows-1252"]),
      delimiter: z.enum(["comma", "semicolon", "tab", "pipe"]),
    })
    .parse(input);
  return attempt(async () => {
    const t = await getTranslations("products");
    const row = await rereadCsv(getDb(), getStorage(), actingUser(user), data);
    if (row.valid) return t("import.rereadDone");
    const ref = (row.meta as FileMeta | null)?.messageRef;
    return row.message ? await refText(ref, row.message) : t("import.rereadFailed");
  });
}

export async function optionsAction(input: {
  clientId: string;
  importId: string;
  options: z.input<typeof importOptionsSchema>;
}): Promise<ActionResult> {
  const user = await requireUser();
  const data = ids.extend({ options: importOptionsSchema }).parse(input);
  return attempt(() => setImportOptions(getDb(), actingUser(user), data));
}

export async function startAction(input: {
  clientId: string;
  importId: string;
  aiConfirmed: boolean;
}): Promise<ActionResult> {
  const user = await requireUser();
  const data = ids.extend({ aiConfirmed: z.boolean() }).parse(input);
  return attempt(async () => {
    await startImport(getDb(), enqueueImportStep, actingUser(user), {
      ...data,
      aiAvailable: await aiAvailable(data.clientId),
    });
    return (await getTranslations("products"))("import.started");
  });
}

export async function confirmMappingAction(input: {
  clientId: string;
  importId: string;
  fileId: string;
  mapping: z.input<typeof columnMappingSchema>;
  saveAs?: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  const data = ids
    .extend({
      fileId: z.uuid(),
      mapping: columnMappingSchema,
      saveAs: z.string().max(80).optional(),
    })
    .parse(input);
  return attempt(async () => {
    const r = await confirmMapping(getDb(), enqueueImportStep, actingUser(user), data);
    const t = await getTranslations("products");
    return r.resumed ? t("import.mappingResumed") : t("import.mappingConfirmed");
  });
}

export async function retryAction(input: {
  clientId: string;
  importId: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  const data = ids.parse(input);
  return attempt(async () => {
    await retryImport(getDb(), enqueueImportStep, actingUser(user), data);
    return (await getTranslations("products"))("import.resumed");
  });
}

export async function cancelAction(input: {
  clientId: string;
  importId: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  const data = ids.parse(input);
  return attempt(async () => {
    await cancelImport(getDb(), actingUser(user), data, cancelImportJob);
    return (await getTranslations("products"))("import.cancelledDone");
  });
}
