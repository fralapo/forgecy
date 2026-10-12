/** Optional Meta insights. Never turn a permission error or missing metric into zero. */
export const IG_MEDIA_INSIGHT_METRICS=["reach","saved","shares"] as const;
export type IgMetricName=(typeof IG_MEDIA_INSIGHT_METRICS)[number];
export function parseInsights(payload:unknown):Record<string,number>{
 const parsed=payload as {data?:Array<{name?:string;total_value?:{value?:unknown};values?:Array<{value?:unknown}>}>};
 const result:Record<string,number>={};
 if(!Array.isArray(parsed?.data))return result;
 for(const item of parsed.data){
   if(typeof item.name!=="string")continue;
   const value=item.total_value?.value??item.values?.at(-1)?.value;
   if(typeof value==="number"&&Number.isFinite(value)&&value>=0)result[item.name]=value;
 }
 return result;
}
export async function optionalMetaInsights(
 mediaId:string,token:string,version:string,metrics:readonly string[]=IG_MEDIA_INSIGHT_METRICS
):Promise<{insights:Record<string,number>;available:boolean}>{
 const url=new URL("https://graph.facebook.com/"+version+"/"+encodeURIComponent(mediaId)+"/insights");
 url.searchParams.set("metric",metrics.join(","));
 url.searchParams.set("access_token",token);
 try{
   const response=await fetch(url.toString(),{cache:"no-store",signal:AbortSignal.timeout(9000)});
   if(!response.ok)return {insights:{},available:false};
   const insights=parseInsights(await response.json());
   return {insights,available:Object.keys(insights).length>0};
 }catch{
   return {insights:{},available:false};
 }
}
