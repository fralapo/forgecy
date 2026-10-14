import type { Context } from "./http";
import { ApiFailure } from "./http";
import { websiteIngestEnabled } from "./crawl-config";

export function requireWebsiteCrawlingEnabled(
  enabled=process.env.ENABLE_WEBSITE_INGEST
):void {
  if(!websiteIngestEnabled(enabled))throw new ApiFailure(503,
    "Importazione automatica dei siti disabilitata nelle impostazioni del server.");
}

/**
 * Reserve per-client and per-owner capacity BEFORE any DNS or HTTP work.
 * Never fall back to in-memory counters or allow crawling if the transaction fails.
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
