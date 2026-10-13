import type {ObservedSnapshot} from "@/lib/social-analytics";
export type Client={
 id:string;name:string;industry:string;website?:string|null;
 profile:Record<string,unknown>;knowledge_revision:number;created_at?:string;
};
export type Source={id:string;client_id:string;kind:string;title:string;url?:string|null;body:string;status:string;file_path?:string|null;error?:string|null};
export type Offer={id:string;client_id:string;kind:"product"|"service";name:string;description:string;audience:string;benefits:string[];price:number|null;currency:string;cta:string;status:"draft"|"verified"|"archived";version:number};
export type Dossier={id:string;version:number;status:"draft"|"stale"|"approved";summary:string;findings:Array<{topic:string;claim:string;source_ids:string[];certainty:string;evidence_quote?:string}>;knowledge_revision:number;evidence_report?:{verified:number;inferred:number;unknown:number;downgraded:number;invalid_source_references:number;unsupported_quotes:number;total:number;checked_at:string}};
export type Campaign={id:string;title:string;objective:string;period:string;offer_id:string|null;status:string;strategy:Record<string,unknown>;created_at:string};
export type Slide={headline:string;body:string;visual_prompt?:string;image_path?:string;layout?:"cover"|"content"|"quote"|"closing"};
export type EditorialBrief={audience_need:string;hook:string;promise:string;value_delivered:string;emotional_angle:string;rational_proof:string;single_cta:string;community_signal_ids:string[]};
export type CommunitySignal={id:string;client_id:string;platform:string;kind:string;topic:string;excerpt:string;audience_need:string;source_url:string|null;context:string;observed_at:string;created_at:string};
export type Content={id:string;client_id:string;campaign_id:string;offer_id?:string|null;parent_id?:string|null;title:string;caption:string;channel:"instagram"|"linkedin";format:"post"|"carousel"|"document";status:"draft"|"review"|"approved"|"stale";slides:Slide[];editorial_brief?:Partial<EditorialBrief>;revision:number;source_revision?:number;offer_version?:number};
export type Message={id:string;role:"user"|"leader";body:string;created_at:string;metadata?:{kind?:string;signal?:Partial<CommunitySignal>}};
export type Mission={id:string;request:string;status:string;payload:Record<string,unknown>;error?:string|null;created_at:string};
export type AgentEvent={id:string;mission_id:string;agent:string;recipient:string;summary:string;created_at:string};
export type StrategicBlueprint={
 title:string;diagnosis:string;positioning:string;audiences:string[];
 objectives:Array<{goal:string;kpi:string;baseline:string|null;target:string;rationale:string}>;
 content_pillars:Array<{name:string;purpose:string;examples:string[]}>;
 channels:string[];roadmap:{days_30:string[];days_60:string[];days_90:string[]};
 risks:string[];unknowns:string[];evidence_source_ids:string[];
};
export type StrategyRecord={
 id:string;client_id:string;dossier_id:string;version:number;status:"draft"|"approved"|"stale";
 knowledge_revision:number;blueprint:StrategicBlueprint;created_at:string;approved_at?:string|null;
};
export type AiJob={
 id:string;client_id:string;kind:"dossier"|"mission"|"strategy";status:"queued"|"running"|"succeeded"|"failed"|"cancelled";
 attempts:number;max_attempts:number;created_at:string;updated_at:string;finished_at?:string|null;
 error?:string|null;result?:Record<string,unknown>
};
export type EditorialEntry={
 id:string;client_id:string;content_id:string|null;
 channel:"instagram"|"linkedin"|"facebook"|"website"|"email";
 title:string;notes:string;status:"idea"|"planned"|"ready"|"completed"|"cancelled";
 planned_at:string;timezone:string;created_at:string;updated_at:string;created_by:string
};
export type Snapshot={
 client:Client;sources:Source[];community_signals:CommunitySignal[];offers:Offer[];dossiers:Dossier[];campaigns:Campaign[];
 contents:Content[];messages:Message[];missions:Mission[];agent_events:AgentEvent[];ai_jobs:AiJob[];strategies:StrategyRecord[];editorial_entries:EditorialEntry[];
 social_accounts:Array<{id:string;username:string;remote_id:string;token_expires_at?:string}>;
 social_snapshots:ObservedSnapshot[];
};
export type View="today"|"knowledge"|"offers"|"projects"|"results"|"settings";
export async function requestJson<T=Record<string,unknown>>(url:string,init:RequestInit={}):Promise<T>{
 const headers:Record<string,string>={};
 if(!(init.body instanceof FormData))headers["Content-Type"]="application/json";
 const response=await fetch(url,{...init,headers:{...headers,...init.headers},cache:"no-store"});
 let data:Record<string,unknown>={};
 try{data=await response.json() as Record<string,unknown>}catch{}
 if(response.status===401 && typeof window!=="undefined")window.location.assign("/login");
 if(!response.ok)throw new Error(typeof data.error==="string"?data.error:("Richiesta non riuscita: HTTP "+response.status));
 return data as T;
}
export const statusLabel=(s:string)=>({approved:"Approvato",draft:"Bozza",stale:"Da aggiornare",proposed:"Da approvare",verified:"Verificato",archived:"Archiviato",running:"In lavorazione",failed:"Errore",review:"In revisione",active:"Attiva",completed:"Conclusa"}[s]||s);
export const offerLabel=(o:Offer)=>o.price==null?"Su preventivo":new Intl.NumberFormat("it-IT",{style:"currency",currency:o.currency||"EUR"}).format(o.price);
export function initials(s:string){return s.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase()}
