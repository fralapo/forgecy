/**
 * The client's name when it was only guessed from the website address ("Add a brand" with a
 * link): after the crawl, the name the site gives itself replaces it. Never a name a person
 * wrote, and only on behalf of someone who may edit the client.
 */
import { can } from "@forgecy/core";
import {
  and,
  auditEvents,
  clients,
  eq,
  inArray,
  recordAuditEvent,
  userActor,
  type Database,
} from "@forgecy/db";

/** "https://www.deodue.it/shop" → "Deodue": the first label of the host, www removed, capitalized. */
export function nameFromUrl(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // Callers validate first; an unreadable address gets the fallback below.
  }
  const label =
    host
      .replace(/^www\./i, "")
      .split(".")[0]
      ?.replace(/-+/g, " ")
      .trim() ?? "";
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : "Brand";
}

const NAME_MAX = 120;
/** Separators between the page and the site in a <title>: "Prodotti - DeoDue", "Shop | Acme". */
const TITLE_SEPARATOR = /\s+[-|–—·•:]\s+/;
/** Page names that are never the brand. */
const GENERIC = /^(home|homepage|home page|welcome|benvenuti|index)$/i;

const clean = (s: string | undefined) =>
  (s ?? "")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX);

/** Letters and digits only, lower case: "Deo-Due" and "deodue" are the same word. */
const wordKey = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * The name the site gives itself. A name that is also the site's domain wins wherever it is
 * declared (the JSON-LD Organization is often the company behind the brand: "ChimiClean S.p.A."
 * on deodue.it, whose og:site_name is "DeoDue - ChimiClean S.p.A."). Otherwise the JSON-LD
 * Organization name, else og:site_name, else the part of the page titles that repeats across
 * pages (the shortest one on a tie); a title part counts only from a title that has a
 * separator, or when two pages share it. Pure.
 */
export function siteBrandName(site: {
  organizationName?: string | undefined;
  siteName?: string | undefined;
  titles: readonly string[];
  /** The site's address: a declared name that matches its domain is the brand's. */
  url?: string | undefined;
}): string | null {
  const titlePart = repeatedTitlePart(site.titles);
  let labels: string[] = [];
  try {
    labels = site.url ? new URL(site.url).hostname.split(".").map(wordKey) : [];
  } catch {
    // No address, no domain match.
  }
  const inDomain = (name: string) => {
    const k = wordKey(name);
    return k.length >= 3 && labels.some((l) => l === k);
  };
  const parts = (s: string | undefined) => (s ?? "").split(TITLE_SEPARATOR).map(clean);
  const domainName = [
    clean(site.organizationName),
    ...parts(site.siteName),
    ...site.titles.flatMap(parts),
  ].find(inDomain);
  if (domainName) return domainName;
  for (const declared of [site.organizationName, site.siteName]) {
    const name = clean(declared);
    if (name.length >= 2) return name;
  }
  return titlePart;
}

function repeatedTitlePart(titles: readonly string[]): string | null {
  const seen = new Map<string, { name: string; pages: number; split: boolean }>();
  for (const title of titles) {
    const parts = title.split(TITLE_SEPARATOR);
    for (const part of new Set(parts.map(clean))) {
      if (part.length < 2 || GENERIC.test(part)) continue;
      const key = part.toLowerCase();
      const prev = seen.get(key);
      seen.set(key, {
        name: prev?.name ?? part,
        pages: (prev?.pages ?? 0) + 1,
        split: (prev?.split ?? false) || parts.length > 1,
      });
    }
  }
  const best = [...seen.values()]
    .filter((p) => p.split || p.pages >= 2)
    .sort((a, b) => b.pages - a.pages || a.name.length - b.name.length)[0];
  return best?.name ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Renames the client to `name` when its name is still the one guessed from its website address
 * and nobody edited the client by hand, as the person who started the import when they may edit
 * the client (`project.edit`). Nothing else is recomputed (the slug stays). True when renamed.
 */
export async function renameFromSite(
  db: Database,
  input: { clientId: string; requestedBy: string | null; name: string | null },
): Promise<boolean> {
  const name = clean(input.name ?? "");
  if (name.length < 2 || !input.requestedBy || !UUID.test(input.requestedBy)) return false;
  const actor = await userActor(db, input.requestedBy);
  if (!actor?.active || !can(actor, "project.edit", input.clientId)) return false;
  return db.transaction(async (tx) => {
    const [client] = await tx
      .select({ name: clients.name, websiteUrl: clients.websiteUrl })
      .from(clients)
      .where(eq(clients.id, input.clientId));
    if (!client?.websiteUrl || client.name === name) return false;
    if (client.name !== nameFromUrl(client.websiteUrl)) return false;
    // A person who saved the client's details may have chosen that very name.
    const [edited] = await tx
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.clientId, input.clientId),
          inArray(auditEvents.action, ["prospect.update", "client.rename"]),
        ),
      )
      .limit(1);
    if (edited) return false;
    const [renamed] = await tx
      .update(clients)
      .set({ name })
      .where(and(eq(clients.id, input.clientId), eq(clients.name, client.name)))
      .returning({ id: clients.id });
    if (!renamed) return false;
    await recordAuditEvent(tx, {
      actor,
      action: "client.rename",
      entity: "client",
      entityId: input.clientId,
      clientId: input.clientId,
      meta: { auto: true, from: client.name, to: name },
    });
    return true;
  });
}
