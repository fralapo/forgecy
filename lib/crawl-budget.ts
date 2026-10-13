import type { Context } from "./http";
import { ApiFailure } from "./http";

/**
 * Crawler must remain opt-in until egress filtering blocks private/link-local
 * destinations at the hosting-network boundary.
 */
export function requireWebsiteCrawlingEnabled(
  enabled=process.env.ENABLE_WEBSITE_INGEST
):void {
  if(enabled!=="true")throw new ApiFailure(503,
    "Importazione automatica dei siti non abilitata. Configura prima le protezioni di rete.");
}

/**
 * Reserve shared per-client and per-owner capacity BEFORE any DNS or HTTP work.
 * Never fall back to in-memory counters or allow crawling if the RPC fails.
 */
export async function reserveWebsiteCrawl(
  ctx:Context,clientId:string,hostname:string,maxPages:number
):Promise<string>{
  const {data,error}=await ctx.db.rpc("forgecy_reserve_website_crawl",{
    p_client_id:clientId,p_hostname:hostname,p_page_budget:maxPages
  });
  if(error?.code==="P0429"){
    throw new ApiFailure(429,
      "Limite di acquisizione raggiunto per il cliente o per il workspace. Riprova più tardi.");
  }
  if(error){
    console.error("[crawl-budget] reservation rejected",error.code);
    throw new ApiFailure(503,"Il controllo del budget web non è disponibile: acquisizione interrotta.");
  }
  if(typeof data!=="string"||!data){
    throw new ApiFailure(503,"La prenotazione del budget web non è stata confermata.");
  }
  return data;
}
