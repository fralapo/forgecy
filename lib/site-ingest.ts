import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent, fetch as pinnedFetch } from "undici";
import { load } from "cheerio";

const USER_AGENT = "ForgecyResearch/1.0 (+client-authorized website analysis)";
const MAX_HTML_BYTES = 1_000_000;
const MAX_ROBOTS_BYTES = 96_000;
const MAX_PAGES = 6;
const BAD_PATH = /\/(?:admin|wp-admin|login|signin|signup|cart|checkout|account|privacy|cookie|terms|logout|feed)(?:\/|$)/i;

export type WebsitePage = {
  title: string;
  description: string;
  body: string;
  url: string;
  capturedAt: string;
  contentSha256: string;
  links: string[];
};

/** URL checks complement, but never replace, outbound network firewall rules. */
export function publicHttpsUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("URL del sito non valida"); }
  if (url.protocol !== "https:" || (url.port && url.port !== "443") ||
      url.username || url.password || url.hostname.endsWith(".") ||
      url.hostname.length > 253 || !/^[a-z0-9.-]+$/i.test(url.hostname) ||
      !url.hostname.includes(".") || ipaddr.isValid(url.hostname) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname) ||
      /(?:^|\.)localhost$/.test(url.hostname)) {
    throw new Error("Sono consentiti soltanto domini DNS pubblici in HTTPS sulla porta 443");
  }
  url.hash = "";
  return url;
}

/** No redirects; DNS lookups are pinned to the actual TLS connection. */
async function fetchPublicText(url: URL, maxBytes: number, type: "html"|"robots"):
  Promise<{status:number; text:string}> {
  const checked = publicHttpsUrl(url.toString());
  const records = await lookup(checked.hostname, { all: true, verbatim: true });
  if (!records.length || records.some(a => {
    try { return ipaddr.parse(a.address).range() !== "unicast"; }
    catch { return true; }
  })) throw new Error("L'host risolve a una rete non pubblica");
  const ipv4 = records.find(a => a.family === 4);
  if (!ipv4) throw new Error("Il sito non dispone di IPv4 pubblico");
  const dispatcher = new Agent({ connect: {
    lookup(_hostname, _options, cb) { cb(null, ipv4.address, 4); },
    timeout: 4_000
  } });
  try {
    const response = await pinnedFetch(checked.toString(), {
      method: "GET",
      redirect: "error",
      dispatcher,
      headers: { "User-Agent": USER_AGENT, "Accept": type === "html" ? "text/html" : "text/plain,*/*;q=0.5" },
      signal: AbortSignal.timeout(9_000)
    });
    if (type === "robots" && response.status === 404) {
      await response.body?.cancel();
      return { status: 404, text: "" };
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Risposta HTTP " + response.status + " durante l'acquisizione");
    }
    const mime = response.headers.get("content-type") || "";
    if (type === "html" && !mime.toLowerCase().includes("text/html")) {
      await response.body?.cancel();
      throw new Error("La pagina non è HTML");
    }
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > maxBytes) {
      await response.body?.cancel();
      throw new Error("La risposta supera il limite consentito");
    }
    if (!response.body) throw new Error("Risposta senza contenuto");
    let length = 0;
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > maxBytes) throw new Error("La pagina supera il limite di acquisizione");
      chunks.push(chunk);
    }
    return { status: response.status, text: Buffer.concat(chunks).toString("utf8") };
  } finally { await dispatcher.close(); }
}

export type RobotRule = { agent: string; action: "allow"|"disallow"; path: string };
/** RFC 9309 subset: matching agent groups, path-prefix, * and terminal $. */
export function parseRobots(text: string): RobotRule[] {
  const rules: RobotRule[] = [];
  let agents: string[] = [];
  let hasRules = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const key = line.slice(0,colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (hasRules) { agents = []; hasRules = false; }
      agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && agents.length) {
      hasRules = true;
      for (const agent of agents) rules.push({ agent, action: key, path: value });
    }
  }
  return rules;
}
export function robotsPermit(rules: RobotRule[], url: URL, bot = "forgecyresearch"): boolean {
  const lower = bot.toLowerCase();
  const specific = rules.filter(r => r.agent !== "*" && lower.includes(r.agent) && !!r.agent);
  const applicable = specific.length ? specific : rules.filter(r => r.agent === "*");
  const path = url.pathname + url.search;
  let winner: { score:number; action:"allow"|"disallow" }|undefined;
  for (const rule of applicable) {
    if (!rule.path) continue;
    const escaped = rule.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const regex = new RegExp("^" + escaped.replace(/\$$/, "$"));
    if (!regex.test(path)) continue;
    const score = rule.path.replace(/[*$]/g,"").length;
    if (!winner || score > winner.score || (score === winner.score && rule.action === "allow"))
      winner = { score, action: rule.action };
  }
  return winner?.action !== "disallow";
}

function rank(url: URL): number {
  const path = url.pathname.toLowerCase();
  if (/\b(about|chi-siamo|azienda|company|mission)\b/.test(path)) return 0;
  if (/\b(serviz|service|prodott|product|solution|soluzion)\b/.test(path)) return 1;
  if (/\b(contatt|contact|team|storia)\b/.test(path)) return 2;
  return 10 + path.length / 100;
}

function pageFromHtml(url: URL, html: string): WebsitePage {
  const $ = load(html);
  const links = new Set<string>();
  $("a[href]").each((_,element) => {
    if (links.size > 90) return;
    const href = $(element).attr("href");
    if (!href || href.startsWith("#")) return;
    try {
      const candidate = publicHttpsUrl(new URL(href,url).toString());
      if (candidate.hostname !== url.hostname || BAD_PATH.test(candidate.pathname)) return;
      if (/\.(?:pdf|jpg|png|mp4|zip|webp|xml|json)$/i.test(candidate.pathname)) return;
      candidate.search = "";
      links.add(candidate.toString());
    } catch { /* invalid or unsafe URL; ignore */ }
  });
  const title = $("title").first().text().replace(/\s+/g," ").trim().slice(0,300);
  const description = $('meta[name="description"]').attr("content")?.trim().slice(0,1000) || "";
  $("script,style,svg,noscript,iframe,form,nav,footer,header").remove();
  const body = ($("main").text() || $("article").text() || $("body").text())
    .replace(/\s+/g," ").trim().slice(0,24000);
  if (!body || body.length < 30) throw new Error("Nessun testo significativo nella pagina");
  const checksum = createHash("sha256").update(description + "\n" + body).digest("hex");
  return { url:url.toString(), title, description, body, capturedAt:new Date().toISOString(),
    contentSha256:checksum, links:[...links].sort((a,b)=>rank(new URL(a))-rank(new URL(b))) };
}

export async function inspectWebsite(rawUrl:string):Promise<WebsitePage> {
  if (process.env.ENABLE_WEBSITE_INGEST !== "true")
    throw new Error("Acquisizione web disabilitata dall'amministratore");
  const url = publicHttpsUrl(rawUrl);
  const robotsUrl = new URL("/robots.txt",url.origin);
  const robots = await fetchPublicText(robotsUrl,MAX_ROBOTS_BYTES,"robots");
  const rules = robots.status === 404 ? [] : parseRobots(robots.text);
  if (!robotsPermit(rules,url)) throw new Error("La pagina non consente l'acquisizione secondo robots.txt");
  return pageFromHtml(url,(await fetchPublicText(url,MAX_HTML_BYTES,"html")).text);
}

/** Bounded same-host crawl. Every URL independently revalidates DNS and robots. */
export async function crawlWebsite(rawUrl:string,maxPages=5):Promise<{
  pages:WebsitePage[]; skipped:Array<{url:string;reason:string}>;
}> {
  if (process.env.ENABLE_WEBSITE_INGEST !== "true")
    throw new Error("Acquisizione web disabilitata dall'amministratore");
  const base = publicHttpsUrl(rawUrl);
  const robots = await fetchPublicText(new URL("/robots.txt",base.origin),MAX_ROBOTS_BYTES,"robots");
  const rules = robots.status === 404 ? [] : parseRobots(robots.text);
  const cap = Math.min(MAX_PAGES,Math.max(1,Math.floor(maxPages)));
  const pending = [base.toString()];
  const visited = new Set<string>();
  const pages:WebsitePage[] = [];
  const skipped:Array<{url:string;reason:string}> = [];
  // At most 2 failed supplemental fetches; never fetch other domains.
  while (pending.length && pages.length < cap && visited.size < cap + 2) {
    const current = pending.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const target = publicHttpsUrl(current);
    if (target.hostname !== base.hostname || BAD_PATH.test(target.pathname) ||
        !robotsPermit(rules,target)) {
      skipped.push({url:current,reason:"Dominio, percorso o robots.txt non consentito"});
      if (current === base.toString()) throw new Error("La pagina iniziale è esclusa da robots.txt");
      continue;
    }
    try {
      const page = pageFromHtml(target,(await fetchPublicText(target,MAX_HTML_BYTES,"html")).text);
      pages.push(page);
      if (pages.length === 1) {
        for (const link of page.links) if (!visited.has(link) && !pending.includes(link)) pending.push(link);
      }
    } catch (error) {
      if (current === base.toString()) throw error;
      skipped.push({url:current,reason:error instanceof Error ? error.message.slice(0,160) : "Errore"});
    }
  }
  return {pages,skipped};
}
