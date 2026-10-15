import { load } from "cheerio";
import { ApiFailure } from "@/lib/http";

const COUNT = "([0-9][0-9.,]*\\s*(?:k|m|b|mila|mln|mld)?)";

function parseCount(raw: string): { value: number; precision: "exact" | "rounded" } | null {
  const value = raw.trim().toLowerCase().replace(/\s+/g, "");
  const suffix = /(?:k|m|b|mila|mln|mld)$/.exec(value)?.[0];
  const numeric = suffix ? value.slice(0, -suffix.length).replace(",", ".") : value;
  const multiplier = suffix ? ({ k: 1e3, mila: 1e3, m: 1e6, mln: 1e6, b: 1e9, mld: 1e9 }[suffix] ?? 1) : 1;
  const normalized = suffix
    ? numeric
    : /^\d{1,3}(?:[.,]\d{3})+$/.test(numeric)
      ? numeric.replace(/[.,]/g, "")
      : numeric;
  const number = Number(normalized);
  return Number.isSafeInteger(Math.round(number * multiplier)) && Number.isFinite(number)
    ? { value: Math.round(number * multiplier), precision: suffix || number * multiplier >= 10_000 ? "rounded" : "exact" }
    : null;
}

function firstCount(description: string, labels: string): { value: number; precision: "exact" | "rounded" } | null {
  const match = new RegExp(`${COUNT}\\s+${labels}\\b`, "i").exec(description);
  return match ? parseCount(match[1]!) : null;
}

export function parsePublicInstagramProfile(html: string, username: string) {
  const $ = load(html);
  const title = $("meta[property='og:title']").attr("content") ?? $("title").text();
  const description = $("meta[property='og:description']").attr("content") ?? $("meta[name='description']").attr("content") ?? "";
  const normalizedDescription = description.replace(/\s+/g, " ").trim();
  if (/account is private|accounto è privato|cuenta es privada|compte est privé/i.test(`${title} ${description}`)) {
    throw new ApiFailure(422, "Il profilo è privato. Forgecy non tenta di accedervi.");
  }
  const followers = firstCount(normalizedDescription, "followers?|follower|abonnés|seguidores");
  const posts = firstCount(normalizedDescription, "posts?|post|publicaciones|publications");
  if (followers === null && posts === null) {
    throw new ApiFailure(422, "Instagram non ha esposto i conteggi nella pagina pubblica. Potrebbe esserci una schermata di accesso o una modifica del sito; nessun dato è stato salvato.");
  }
  return {
    account: {
      username,
      ...(followers !== null ? { followers_count: followers.value } : {}),
      ...(posts !== null ? { media_count: posts.value } : {}),
    },
    media: [],
    metric_precision: {
      ...(followers !== null ? { followers_count: followers.precision } : {}),
      ...(posts !== null ? { media_count: posts.precision } : {}),
    },
    source: "Pagina profilo Instagram pubblica (lettura anonima)",
    measured: true,
    insights_status: "unavailable",
    metric_scope: "public_profile_page",
  };
}

export async function collectPublicInstagramProfile(username: string) {
  const response = await fetch(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "it-IT,it;q=0.9,en;q=0.7",
      "User-Agent": "Forgecy public profile reader (manual refresh; no login or cookies)",
    },
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    throw new ApiFailure(422, "Instagram ha reindirizzato la richiesta (possibile login wall o challenge). Aggiornamento interrotto.");
  }
  if (response.status === 429) throw new ApiFailure(429, "Instagram ha limitato la richiesta. Forgecy ha fermato l’aggiornamento: riprova più tardi.");
  if (response.status === 403 || response.status === 401) throw new ApiFailure(403, "Instagram ha negato la lettura pubblica. Forgecy non prova ad aggirare il blocco.");
  if (!response.ok) throw new ApiFailure(502, `Instagram ha risposto con HTTP ${response.status}. Nessun retry automatico è stato avviato.`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) throw new ApiFailure(502, "La risposta Instagram non è una pagina HTML del profilo.");
  const reader = response.body?.getReader();
  if (!reader) throw new ApiFailure(502, "La pagina Instagram è vuota.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4_000_000) {
        await reader.cancel().catch(() => undefined);
        throw new ApiFailure(413, "La pagina Instagram supera il limite di lettura di Forgecy.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return parsePublicInstagramProfile(new TextDecoder().decode(bytes), username);
}
