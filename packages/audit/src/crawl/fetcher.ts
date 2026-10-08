import type { PageData } from "@forgecy/db";
import { parse, type HTMLElement } from "node-html-parser";
import { crawlError } from "../errors";
import { createPinnedFetch, type HostCheck } from "../url";

/** What a fetcher returns for one page. Colors and fonts need a browser; HTML-only leaves them empty. */
export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number;
  title: string;
  data: PageData;
  /** Absolute links found in the page. */
  links: string[];
  /** Links inside header/nav: the site menu. */
  navLinks: string[];
  colors: Array<{ hex: string; weight: number }>;
  fonts: Array<{ family: string; role: "headings" | "body"; weight: number }>;
  requiresLogin: boolean;
  screenshotDesktop?: Uint8Array;
  screenshotMobile?: Uint8Array;
}

export interface FetchOptions {
  timeoutMs: number;
  screenshots: boolean;
}

export interface PageFetcher {
  /** "browser" takes screenshots and computed styles; "html" reads markup only. */
  readonly mode: "browser" | "html";
  fetchPage(url: string, options: FetchOptions): Promise<FetchedPage>;
  close(): Promise<void>;
}

/** Recognizable user agent, as the spec requires; robots.txt rules match "ForgecyAudit". */
export const AUDIT_USER_AGENT_TOKEN = "ForgecyAudit";
export function auditUserAgent(baseUrl = "https://github.com/fralapo/forgecy"): string {
  return `Mozilla/5.0 (compatible; ${AUDIT_USER_AGENT_TOKEN}/1.0; +${baseUrl})`;
}

// Italian and English CTA stems: client websites are mostly Italian.
const CTA_WORDS =
  /\b(contatt|preventiv|richied|prenot|scopri|acquist|compra|iscriv|scaric|chiama|scrivi|inizia|prova|registr|ordina|contact|quote|book|buy|shop|sign ?up|subscribe|download|call|get started|try|request|demo)/i;

const MAX_TEXT = 4000;

function clean(text: string | undefined | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function absolute(href: string | undefined, base: string): string | null {
  if (!href) return null;
  const h = href.trim();
  if (!h || h.startsWith("#") || /^(mailto|tel|javascript|data):/i.test(h)) return null;
  try {
    const u = new URL(h, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

const JSON_LD =
  /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;

/** schema.org types declared in the page's JSON-LD blocks (nested @graph included). */
export function structuredDataTypes(html: string): string[] {
  const types = new Set<string>();
  const visit = (node: unknown, depth: number): void => {
    if (depth > 4 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.slice(0, 50).forEach((n) => visit(n, depth + 1));
    const obj = node as Record<string, unknown>;
    for (const t of [obj["@type"]].flat())
      if (typeof t === "string" && t.length <= 60) types.add(t.replace(/^.*[/#:]/, ""));
    if (obj["@graph"]) visit(obj["@graph"], depth + 1);
  };
  for (const m of html.matchAll(JSON_LD)) {
    try {
      visit(JSON.parse(m[1]!), 0);
    } catch {
      // Invalid JSON-LD declares nothing a search engine can read.
    }
  }
  return [...types].slice(0, 20);
}

/** Extract page data from markup. Shared by the HTML fetcher and the browser fallback. */
export function extractFromHtml(
  html: string,
  pageUrl: string,
): Omit<FetchedPage, "url" | "finalUrl" | "status" | "colors" | "fonts"> {
  const root = parse(html, { comment: false, blockTextElements: { script: false, style: false } });
  const text = (el: HTMLElement | null) => clean(el?.textContent);
  const title = text(root.querySelector("title"));
  const links = new Set<string>();
  const navLinks = new Set<string>();
  for (const a of root.querySelectorAll("a[href]")) {
    const href = absolute(a.getAttribute("href"), pageUrl);
    if (!href) continue;
    links.add(href);
    if (a.closest("nav") || a.closest("header")) navLinks.add(href);
  }
  const ctas = new Set<string>();
  for (const el of root.querySelectorAll("a, button, input[type=submit]")) {
    const label = clean(el.tagName === "INPUT" ? el.getAttribute("value") : el.textContent);
    const cls = el.getAttribute("class") ?? "";
    if (label.length < 2 || label.length > 60) continue;
    if (el.tagName === "BUTTON" || /\b(btn|button|cta)\b/i.test(cls) || CTA_WORDS.test(label))
      if (CTA_WORDS.test(label) || el.tagName !== "A") ctas.add(label);
  }
  const images = root.querySelectorAll("img");
  const forms = root.querySelectorAll("form");
  const contactForm = forms.some(
    (f) => f.querySelector("textarea") !== null || f.querySelector("input[type=email]") !== null,
  );
  const requiresLogin = root.querySelector("input[type=password]") !== null;
  const headings = root
    .querySelectorAll("h1, h2, h3")
    .slice(0, 40)
    .map((h) => ({ level: Number(h.tagName.slice(1)), text: text(h) }))
    .filter((h) => h.text);
  const body = root.querySelector("body") ?? root;
  return {
    title,
    links: [...links],
    navLinks: [...navLinks],
    requiresLogin,
    data: {
      metaDescription:
        root.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ||
        undefined,
      h1: root
        .querySelectorAll("h1")
        .map((h) => text(h))
        .filter(Boolean)
        .slice(0, 5),
      headings,
      ctas: [...ctas].slice(0, 20),
      textExcerpt: clean(body.textContent).slice(0, MAX_TEXT),
      lang: root.querySelector("html")?.getAttribute("lang") ?? undefined,
      hasViewport: root.querySelector('meta[name="viewport"]') !== null,
      imagesTotal: images.length,
      imagesWithoutAlt: images.filter((i) => !i.hasAttribute("alt")).length,
      contactForm,
      structuredDataTypes: structuredDataTypes(html),
      links: links.size,
    },
  };
}

/**
 * Markup-only fetcher, used when no Chromium is available: no screenshots, no
 * computed colors or fonts (the scan is then "Partially collected").
 */
export function createHtmlFetcher(options: {
  userAgent: string;
  hostCheck: HostCheck;
  /** Only to lift the pinned fetch's own validation together with the host check's. */
  allowPrivate?: boolean;
  fetchImpl?: typeof fetch;
}): PageFetcher {
  const doFetch = options.fetchImpl ?? createPinnedFetch({ allowPrivate: options.allowPrivate });
  return {
    mode: "html",
    async fetchPage(url, { timeoutMs }) {
      const started = Date.now();
      let current = url;
      let res: Response | undefined;
      for (let hop = 0; hop < 5; hop++) {
        if (!(await options.hostCheck(current)))
          throw crawlError("AUD-HOST-BLOCKED", "audit.stored.crawl.addressLocal", { url: current });
        res = await doFetch(current, {
          redirect: "manual",
          headers: { "user-agent": options.userAgent, accept: "text/html,*/*;q=0.8" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        const location = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && location) {
          current = new URL(location, current).toString();
          continue;
        }
        break;
      }
      if (!res) throw crawlError("SOURCE-UNAVAILABLE", "audit.stored.crawl.noResponse", { url });
      const type = res.headers.get("content-type") ?? "";
      const html = type.includes("html") ? await res.text() : "";
      const extracted = extractFromHtml(html, current);
      return {
        ...extracted,
        url,
        finalUrl: current,
        status: res.status,
        data: { ...extracted.data, httpStatus: res.status, loadMs: Date.now() - started },
        colors: [],
        fonts: [],
      };
    },
    async close() {},
  };
}
