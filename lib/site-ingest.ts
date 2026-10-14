import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent, fetch as pinnedFetch } from "undici";
import { load } from "cheerio";
import { websiteIngestEnabled } from "./crawl-config";
import { extractWebsiteBrand, WebsiteBrandIdentity, websiteStylesheetUrls } from "./website-brand";

const USER_AGENT = "ForgecyResearch/1.0 (+client-authorized website analysis)";
const MAX_HTML_BYTES = 1_000_000;
const MAX_ROBOTS_BYTES = 96_000;
const MAX_SITEMAP_BYTES = 2_000_000;
const MAX_SITEMAP_DISCOVERED = 500;
const MAX_PAGES = 100;
const MAX_ASSETS = 48;
const MAX_DOCUMENTS = 12;
const MAX_ASSET_BYTES=4_000_000;
const MAX_DOCUMENT_BYTES=10_000_000;
const BAD_PATH = /\/(?:admin|wp-admin|login|signin|signup|cart|checkout|account|privacy(?:-policy)?|cookie(?:-policy)?|terms(?:-and-conditions)?|logout|feed|no-access|access-denied|404)(?:\/|$)/i;

export type WebsiteProduct = {
  name:string; description:string; url:string; image:string; price:number|null; currency:string;
};
export type WebsiteAsset = {url:string;alt:string;role:"logo"|"product"|"image"};
export type WebsiteDocument = {url:string;title:string};

export type WebsitePage = {
  title: string;
  description: string;
  body: string;
  url: string;
  capturedAt: string;
  contentSha256: string;
  links: string[];
  products: WebsiteProduct[];
  assets: WebsiteAsset[];
  documents: WebsiteDocument[];
};

/** URL checks complement, but never replace, outbound network firewall rules. */
export function publicHttpsUrl(value: string): URL {
  let url: URL;
  if (value.length > 2048) throw new Error("URL del sito troppo lunga");
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
async function fetchPublicText(url: URL, maxBytes: number, type: "html"|"robots"|"sitemap"|"css"):
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
    lookup(_hostname, options, cb) {
      if (options.all) cb(null, [{ address: ipv4.address, family: 4 }]);
      else cb(null, ipv4.address, 4);
    },
    timeout: 4_000
  } });
  try {
    const response = await pinnedFetch(checked.toString(), {
      method: "GET",
      redirect: "error",
      dispatcher,
      headers: { "User-Agent": USER_AGENT, "Accept": type === "html" ? "text/html" : type === "sitemap" ? "application/xml,text/xml;q=0.9" : type === "css" ? "text/css,*/*;q=0.2" : "text/plain,*/*;q=0.5" },
      signal: AbortSignal.timeout(9_000)
    });
    if ((type === "robots" || type === "sitemap") && response.status === 404) {
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
    if (type === "sitemap" && !/(?:xml|text\/plain)/i.test(mime)) {
      await response.body?.cancel();
      throw new Error("La sitemap non è XML");
    }
    if (type === "css" && !/(?:text\/css|octet-stream)/i.test(mime)) {
      await response.body?.cancel();
      throw new Error("Il foglio di stile non è CSS");
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

async function inspectWebsiteBrand(url: string, html: string): Promise<WebsiteBrandIdentity> {
  const stylesheets = await Promise.all(websiteStylesheetUrls(url, html).map(async address => {
    try { return (await fetchPublicText(new URL(address), 300_000, "css")).text; }
    catch { return ""; }
  }));
  return extractWebsiteBrand(url, html, stylesheets);
}

export async function fetchWebsiteFile(rawUrl:string,kind:"image"|"document"):
  Promise<{bytes:Uint8Array;contentType:string;extension:string}>{
  const checked=publicHttpsUrl(rawUrl);
  const records=await lookup(checked.hostname,{all:true,verbatim:true});
  if(!records.length||records.some(a=>{try{return ipaddr.parse(a.address).range()!=="unicast";}catch{return true;}}))throw new Error("Host non pubblico");
  const ipv4=records.find(a=>a.family===4);if(!ipv4)throw new Error("IPv4 non disponibile");
  const dispatcher=new Agent({connect:{lookup(_hostname,options,cb){if(options.all)cb(null,[{address:ipv4.address,family:4}]);else cb(null,ipv4.address,4);},timeout:4_000}});
  const max=kind==="image"?MAX_ASSET_BYTES:MAX_DOCUMENT_BYTES;
  try{
    const response=await pinnedFetch(checked.toString(),{method:"GET",redirect:"error",dispatcher,
      headers:{"User-Agent":USER_AGENT,Accept:kind==="image"?"image/png,image/jpeg,image/webp,image/gif,image/avif":"application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv"},signal:AbortSignal.timeout(8_000)});
    if(!response.ok){await response.body?.cancel();throw new Error("Risposta HTTP "+response.status);}
    const mime=(response.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
    const types:Record<string,string>=kind==="image"?{"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif","image/avif":"avif"}:{"application/pdf":"pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document":"docx","text/plain":"txt","text/markdown":"md","text/csv":"csv"};
    const extension=types[mime];if(!extension){await response.body?.cancel();throw new Error("Formato non supportato: "+mime);}
    if(Number(response.headers.get("content-length")||0)>max){await response.body?.cancel();throw new Error("File oltre il limite");}
    if(!response.body)throw new Error("Risposta senza contenuto");
    const chunks:Uint8Array[]=[];let length=0;
    for await(const chunk of response.body){length+=chunk.byteLength;if(length>max)throw new Error("File oltre il limite");chunks.push(chunk);}
    return {bytes:new Uint8Array(Buffer.concat(chunks)),contentType:mime,extension};
  }finally{await dispatcher.close();}
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
    const anchored=rule.path.endsWith("$");
    const raw=anchored?rule.path.slice(0,-1):rule.path;
    const escaped=raw.replace(/[.+?^${}()|[\]\\]/g,"\\$&").replace(/\*/g,".*");
    const regex=new RegExp("^"+escaped+(anchored?"$":""));
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

function jsonLdObjects(value:unknown):Array<Record<string,unknown>>{
  if(Array.isArray(value))return value.flatMap(jsonLdObjects);
  if(!value||typeof value!=="object")return [];
  const row=value as Record<string,unknown>;
  return [row,...jsonLdObjects(row["@graph"]),...jsonLdObjects(row.itemListElement)];
}
function cleanText(value:unknown,max=4000):string{
  return typeof value==="string"?value.replace(/\s+/g," ").trim().slice(0,max):"";
}
type HtmlNode={type:string;name?:string;data?:string;children?:HtmlNode[]};
function structuredPageText(root:{get(index:number):HtmlNode|undefined}):string{
  const blocks:string[]=[];
  let inline="";
  const plainText=(node:HtmlNode):string=>node.type==="text"?(node.data||""):(node.children||[]).map(plainText).join("");
  const flush=()=>{const value=cleanText(inline,6000);if(value)blocks.push(value);inline="";};
  const blockTags=new Set(["address","blockquote","br","div","li","ol","p","pre","section","table","ul"]);
  const visit=(node:HtmlNode):void=>{
    if(node.type==="text"){inline+=node.data||"";return;}
    if(node.type!=="tag"&&node.type!=="root")return;
    const name=String(node.name||"").toLowerCase();
    if(/^h[1-6]$/.test(name)){
      flush();const heading=cleanText(plainText(node),500);if(heading)blocks.push(`## ${heading}`);return;
    }
    if(name==="tr"){
      flush();const cells=(node.children||[]).filter((child:HtmlNode)=>child.type==="tag"&&["th","td"].includes(String(child.name).toLowerCase()))
        .map((child:HtmlNode)=>cleanText(plainText(child),500)).filter(Boolean);
      if(cells.length)blocks.push(cells.join(" | "));return;
    }
    const isBlock=blockTags.has(name);
    if(isBlock)flush();
    for(const child of node.children||[])visit(child);
    if(isBlock)flush();
  };
  for(const child of root.get(0)?.children||[])visit(child);
  flush();
  return blocks.join("\n\n").slice(0,24000);
}
function resolveSiteUrl(value:unknown,base:URL):string{
  if(typeof value!=="string"||!value.trim())return "";
  try{const candidate=publicHttpsUrl(new URL(value,base).toString());return candidate.hostname===base.hostname?candidate.toString():"";}catch{return "";}
}

/** Sitemap XML is discovery data, never a source of instructions. */
export function sitemapUrls(xml:string,root:string,maxItems=MAX_SITEMAP_DISCOVERED):
  { pages:string[]; indices:string[] } {
  const base=publicHttpsUrl(root);
  const $=load(xml,{xmlMode:true});
  const pages:string[]=[];
  const indices:string[]=[];
  const seen=new Set<string>();
  const count=Math.max(1,Math.min(MAX_SITEMAP_DISCOVERED,maxItems));
  const add=(value:string,kind:"pages"|"indices")=>{
    try {
      const parsed=publicHttpsUrl(value.trim());
      if(parsed.origin!==base.origin || BAD_PATH.test(parsed.pathname))return;
      if(kind==="indices"&&!/\.xml$/i.test(parsed.pathname))return;
      if(kind==="pages"&&/\.(?:pdf|jpg|png|mp4|zip|webp|xml|json)$/i.test(parsed.pathname))return;
      parsed.search="";
      const canonical=parsed.toString();
      if(seen.has(canonical))return;
      seen.add(canonical);
      if(kind==="pages")pages.push(canonical);else indices.push(canonical);
    } catch{/* unsafe sitemap entry, ignore */}
  };
  $("urlset > url > loc").slice(0,count*4).each((_,el)=>{if(pages.length<count)add($(el).text(),"pages");});
  $("sitemapindex > sitemap > loc").slice(0,24).each((_,el)=>{if(indices.length<24)add($(el).text(),"indices");});
  pages.sort((a,b)=>rank(new URL(a))-rank(new URL(b)));
  return {pages:pages.slice(0,count),indices:indices.slice(0,24)};
}

export function robotsSitemapUrls(text:string,root:string):string[]{
  const base=publicHttpsUrl(root);
  const choices:string[]=[];
  for(const line of text.split(/\r?\n/)){
    const match=/^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if(!match)continue;
    try{
      const candidate=publicHttpsUrl(match[1]);
      if(candidate.origin===base.origin&&/\.xml$/i.test(candidate.pathname)&&
        !choices.includes(candidate.toString()))choices.push(candidate.toString());
    }catch{/* unsafe external sitemap */}
    if(choices.length>=2)break;
  }
  return choices;
}

async function discoverSitemap(base:URL,robotsText:string,rules:RobotRule[]):Promise<string[]>{
  const urls=robotsSitemapUrls(robotsText,base.toString());
  const defaultSitemap=new URL("/sitemap.xml",base.origin).toString();
  if(!urls.includes(defaultSitemap))urls.push(defaultSitemap);
  const pages:string[]=[];
  for(const address of urls.slice(0,2)){
    const xmlUrl=publicHttpsUrl(address);
    if(!robotsPermit(rules,xmlUrl))continue;
    try{
      const response=await fetchPublicText(xmlUrl,MAX_SITEMAP_BYTES,"sitemap");
      if(response.status===404)continue;
      const first=sitemapUrls(response.text,base.toString());
      pages.push(...first.pages);
      for(const child of first.indices.slice(0,8)){
        const nested=publicHttpsUrl(child);
        if(!robotsPermit(rules,nested))continue;
        const childXml=await fetchPublicText(nested,MAX_SITEMAP_BYTES,"sitemap");
        if(childXml.status!==404)pages.push(...sitemapUrls(childXml.text,base.toString()).pages);
        if(pages.length>=MAX_SITEMAP_DISCOVERED)break;
      }
    }catch{/* sitemap is optional: never block an otherwise permitted homepage */}
  }
  return [...new Set(pages)].sort((a,b)=>rank(new URL(a))-rank(new URL(b))).slice(0,MAX_SITEMAP_DISCOVERED);
}

export function extractWebsitePage(url: URL, html: string): WebsitePage {
  const $ = load(html);
  const links = new Set<string>();
  const assets = new Map<string,WebsiteAsset>();
  const documents = new Map<string,WebsiteDocument>();
  const products = new Map<string,WebsiteProduct>();
  const addAsset = (value:unknown,alt:string,role:WebsiteAsset["role"]) => {
    const resolved=resolveSiteUrl(value,url); if(!resolved || assets.has(resolved)) return;
    assets.set(resolved,{url:resolved,alt:cleanText(alt,300),role});
  };
  const priceNumber=(value:unknown):number|null=>{
    if(value===null||value===undefined||String(value).trim()==="")return null;
    const parsed=Number(String(value).replace(/[^0-9,.-]/g,"").replace(",","."));
    return Number.isFinite(parsed)&&parsed>0?parsed:null;
  };
  const currency=(value:unknown)=>/^[A-Z]{3}$/.test(String(value||""))?String(value):"EUR";
  $("script[type='application/ld+json']").each((_,el)=>{
    try {
      const raw=JSON.parse($(el).contents().text()) as unknown;
      for(const item of jsonLdObjects(raw)){
        const types=Array.isArray(item["@type"])?item["@type"]:[item["@type"]];
        if(types.some(t=>String(t).toLowerCase()==="organization"||String(t).toLowerCase()==="localbusiness")){
          const logo=item.logo;
          addAsset(typeof logo==="string"?logo:(logo&&typeof logo==="object"?(logo as Record<string,unknown>).url:""),"Logo aziendale","logo");
        }
        if(!types.some(t=>String(t).toLowerCase()==="product"))continue;
        const name=cleanText(item.name,180); if(!name)continue;
        const imageValue=item.image;
        const image=resolveSiteUrl(typeof imageValue==="string"?imageValue:Array.isArray(imageValue)?imageValue[0]:imageValue&&typeof imageValue==="object"?(imageValue as Record<string,unknown>).url:"",url);
        addAsset(image,name,"product");
        const offer=(Array.isArray(item.offers)?item.offers[0]:item.offers) as Record<string,unknown>|undefined;
        const p=priceNumber(offer?.price);
        const product:WebsiteProduct={name,description:cleanText(item.description,3000),url:resolveSiteUrl(item.url,url)||url.toString(),image,price:p,currency:currency(offer?.priceCurrency)};
        products.set(product.url+"|"+name,product);
      }
    } catch { /* malformed structured data is ignored */ }
  });
  $("article.dd-product-card, li.product, article.product, .product-card, [itemtype*='Product']").each((_,el)=>{
    const card=$(el); const name=cleanText(card.find("[itemprop='name'],h2,h3,.product-title,.woocommerce-loop-product__title").first().text(),180);
    if(!name)return;
    const href=card.find("a[href]").first().attr("href");
    const productUrl=resolveSiteUrl(href,url)||url.toString();
    const img=card.find("img").first();
    const image=resolveSiteUrl(img.attr("src")||img.attr("data-src")||img.attr("data-lazy-src")||img.attr("srcset")?.split(",").pop()?.trim().split(/\s+/)[0],url);
    const description=cleanText(card.find("[itemprop='description'],.description,.product-description,.dd-product-card__body").text()||card.text(),1200);
    const priceText=card.find("[itemprop='price'],.price").first().attr("content")||card.find("[itemprop='price'],.price").first().text();
    const offer=card.find("[itemprop='priceCurrency']").attr("content");
    products.set(productUrl+"|"+name,{name,description,url:productUrl,image,price:priceNumber(priceText),currency:currency(offer)});
    addAsset(image,name,"product");
  });
  $("img").each((_,el)=>{
    const img=$(el);const alt=cleanText(img.attr("alt"),300);const source=img.attr("src")||img.attr("data-src")||img.attr("data-lazy-src")||img.attr("srcset")?.split(",").pop()?.trim().split(/\s+/)[0];
    const candidate=resolveSiteUrl(source,url);if(!candidate)return;
    const identity=(img.attr("class")||"")+" "+(img.attr("id")||"")+" "+candidate;
    addAsset(candidate,alt,/logo|brand|marchio/i.test(identity)?"logo":"image");
  });
  addAsset($("meta[property='og:image']").attr("content"),"Immagine di copertina","image");
  $("link[rel~='icon'],link[rel='apple-touch-icon']").each((_,el)=>addAsset($(el).attr("href"),"Icona del sito","logo"));
  $("a[href]").each((_,element) => {
    if (links.size > 500) return;
    const href = $(element).attr("href");
    if (!href || href.startsWith("#")) return;
    try {
      const candidate = publicHttpsUrl(new URL(href,url).toString());
      if (candidate.hostname !== url.hostname || BAD_PATH.test(candidate.pathname)) return;
      if (/\.(?:pdf|docx|txt|md|csv)$/i.test(candidate.pathname)) {
        if(documents.size<MAX_DOCUMENTS)documents.set(candidate.toString(),{url:candidate.toString(),title:cleanText($(element).text(),200)||candidate.pathname.split("/").pop()||"Documento"});
        return;
      }
      if (/\.(?:jpg|jpeg|png|gif|webp|avif|svg|mp4|zip|xml|json)$/i.test(candidate.pathname)) return;
      candidate.search = "";
      links.add(candidate.toString());
    } catch { /* invalid or unsafe URL; ignore */ }
  });
  const title = $("title").first().text().replace(/\s+/g," ").trim().slice(0,300);
  const description = $('meta[name="description"]').attr("content")?.trim().slice(0,1000) || "";
  $("script,style,svg,noscript,iframe,form,nav,footer,header").remove();
  const contentRoot=$("main").first().length?$("main").first():$("article").first().length?$("article").first():$("body").first();
  const body=structuredPageText(contentRoot);
  if (!body || body.length < 30) throw new Error("Nessun testo significativo nella pagina");
  const checksum = createHash("sha256").update(description + "\n" + body).digest("hex");
  return { url:url.toString(), title, description, body, capturedAt:new Date().toISOString(),
    contentSha256:checksum, links:[...links].sort((a,b)=>rank(new URL(a))-rank(new URL(b))),
    products:[...products.values()].slice(0,250),assets:[...assets.values()].slice(0,MAX_ASSETS),documents:[...documents.values()] };
}

export async function inspectWebsite(rawUrl:string):Promise<WebsitePage> {
  if (!websiteIngestEnabled())
    throw new Error("Acquisizione web disabilitata dall'amministratore");
  const url = publicHttpsUrl(rawUrl);
  const robotsUrl = new URL("/robots.txt",url.origin);
  const robots = await fetchPublicText(robotsUrl,MAX_ROBOTS_BYTES,"robots");
  const rules = robots.status === 404 ? [] : parseRobots(robots.text);
  if (!robotsPermit(rules,url)) throw new Error("La pagina non consente l'acquisizione secondo robots.txt");
  return extractWebsitePage(url,(await fetchPublicText(url,MAX_HTML_BYTES,"html")).text);
}

/** Bounded same-host crawl. Every URL independently revalidates DNS and robots. */
export async function crawlWebsite(rawUrl:string,maxPages=5):Promise<{
  pages:WebsitePage[]; skipped:Array<{url:string;reason:string}>;products:WebsiteProduct[];assets:WebsiteAsset[];documents:WebsiteDocument[];brand:WebsiteBrandIdentity|null;
}> {
  if (!websiteIngestEnabled())
    throw new Error("Acquisizione web disabilitata dall'amministratore");
  const base = publicHttpsUrl(rawUrl);
  const robots = await fetchPublicText(new URL("/robots.txt",base.origin),MAX_ROBOTS_BYTES,"robots");
  const rules = robots.status === 404 ? [] : parseRobots(robots.text);
  const cap = Math.min(MAX_PAGES,Math.max(1,Math.floor(maxPages)));
  const sitemapPages=cap>1?await discoverSitemap(base,robots.text,rules):[];
  const pending = [base.toString(),...sitemapPages.filter(x=>x!==base.toString()).slice(0,MAX_SITEMAP_DISCOVERED)];
  const visited = new Set<string>();
  const pages:WebsitePage[] = [];
  let brand:WebsiteBrandIdentity|null=null;
  const skipped:Array<{url:string;reason:string}> = [];
  const products=new Map<string,WebsiteProduct>(),assets=new Map<string,WebsiteAsset>(),documents=new Map<string,WebsiteDocument>();
  // Bound concurrency, total pages, and failures; crawl only same-host permitted URLs.
  while (pending.length && pages.length < cap && visited.size < cap + 12) {
    const batch:string[]=[];
    while(batch.length<5&&pending.length&&pages.length+batch.length<cap){const current=pending.shift()!;if(visited.has(current))continue;visited.add(current);batch.push(current);}
    const results=await Promise.all(batch.map(async current=>{
      const target=publicHttpsUrl(current);
      if(target.hostname!==base.hostname||BAD_PATH.test(target.pathname)||!robotsPermit(rules,target))return {current,error:new Error("Dominio, percorso o robots.txt non consentito")};
      try{
        const html=(await fetchPublicText(target,MAX_HTML_BYTES,"html")).text;
        const page=extractWebsitePage(target,html);
        const identity=current===base.toString()?await inspectWebsiteBrand(current,html):null;
        return {current,page,brand:identity};
      }
      catch(error){return {current,error};}
    }));
    for(const result of results){
      if(result.page){pages.push(result.page);if(result.brand)brand=result.brand;for(const p of result.page.products)if(!products.has(p.url+"|"+p.name))products.set(p.url+"|"+p.name,p);for(const a of result.page.assets)if(!assets.has(a.url))assets.set(a.url,a);for(const d of result.page.documents)if(!documents.has(d.url))documents.set(d.url,d);for(const link of result.page.links)if(!visited.has(link)&&!pending.includes(link)&&pending.length<MAX_SITEMAP_DISCOVERED)pending.push(link);}
      else {skipped.push({url:result.current,reason:result.error instanceof Error?result.error.message.slice(0,160):"Errore"});if(result.current===base.toString())throw result.error;}
    }
  }
  return {pages,skipped,products:[...products.values()].slice(0,300),assets:[...assets.values()].slice(0,MAX_ASSETS),documents:[...documents.values()].slice(0,MAX_DOCUMENTS),brand};
}
