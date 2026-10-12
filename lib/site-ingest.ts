import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent, fetch as safeFetch } from "undici";
import { load } from "cheerio";

/** HTTPS-only, pinned DNS, no redirects, limited HTML and bytes. External network egress policies required too. */
export async function inspectWebsite(rawUrl:string) {
  if (process.env.ENABLE_WEBSITE_INGEST !== "true") throw new Error("Acquisizione web disabilitata dall'amministratore");
  const target = new URL(rawUrl);
  if (target.protocol !== "https:" || target.port && target.port !== "443" || target.username || target.password || target.hostname.endsWith(".")) throw new Error("È consentito solo HTTPS pubblico sulla porta 443");
  if (ipaddr.isValid(target.hostname)) throw new Error("Usa un nome DNS pubblico, non un indirizzo IP");
  const answers = await lookup(target.hostname,{all:true,verbatim:true});
  if (!answers.length || answers.some(a => {
    try { return ipaddr.parse(a.address).range() !== "unicast"; } catch { return true; }
  })) throw new Error("Host non pubblico");
  const ipv4=answers.find(a=>a.family===4);
  if (!ipv4) throw new Error("Sito non raggiungibile via IPv4 pubblico");
  const dispatcher = new Agent({connect:{
    lookup(_host,_opts,cb){cb(null,ipv4.address,4);},
    timeout:5000
  }});
  try {
    const response = await safeFetch(target.toString(),{
      method:"GET",redirect:"error",dispatcher,
      headers:{"User-Agent":"ForgecyResearch/1.0 (+manual content verification)","Accept":"text/html"},
      signal:AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error("Sito non disponibile: HTTP " + response.status);
    if (!response.headers.get("content-type")?.includes("text/html")) throw new Error("Formato sito non HTML");
    const declared=Number(response.headers.get("content-length")||0);
    if (declared>1_000_000) throw new Error("Pagina troppo grande");
    let bytes=0;const chunks:Uint8Array[]=[];
    if (!response.body) throw new Error("Risposta vuota");
    for await(const chunk of response.body) {
      bytes+=chunk.byteLength;
      if(bytes>1_000_000) {await response.body.cancel();throw new Error("Pagina troppo grande");}
      chunks.push(chunk);
    }
    const html=Buffer.concat(chunks).toString("utf-8");
    const $=load(html);
    $("script,style,svg,noscript,iframe,form").remove();
    const title=$("title").first().text().trim().slice(0,300);
    const description=$('meta[name="description"]').attr("content")?.slice(0,1000)||"";
    const body=($("main").text()||$("body").text()).replace(/\s+/g," ").trim().slice(0,24000);
    if (!body) throw new Error("Nessun contenuto testuale estraibile");
    return {title,description,body,url:target.toString(),capturedAt:new Date().toISOString()};
  } finally {await dispatcher.close();}
}
