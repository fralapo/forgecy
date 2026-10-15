import { z } from "zod";
const bounded = (max=2000) => z.string().trim().max(max);
export const clientSchema=z.object({
 name:bounded(160).min(1),industry:bounded(160).default(""),website:bounded(600).optional(),
 profile:z.record(z.string(),z.unknown()).default({})
});
export const sourceSchema=z.object({
 kind:z.enum(["website","note","document","social"]),
 title:bounded(180).min(1),
 url:z.url().max(2000).optional(),
 body:bounded(100000).default("")
}).superRefine((source,ctx)=>{
 const hasBody=source.body.trim().length>0;
 if(source.kind==="note"&&!hasBody){
  ctx.addIssue({code:"custom",path:["body"],message:"Aggiungi il contenuto della nota prima di salvarla"});
 }else if((source.kind==="website"||source.kind==="social")&&!source.url&&!hasBody){
  ctx.addIssue({code:"custom",path:["body"],message:"Aggiungi un URL o delle annotazioni prima di salvare la fonte"});
 }
});
export const offerSchema=z.object({
 kind:z.enum(["product","service"]),name:bounded(180).min(1),
 description:bounded(12000).default(""),audience:bounded(3000).default(""),
 benefits:z.array(bounded(300)).max(20).default([]),
 price:z.number().nonnegative().max(99999999).nullable().default(null),
 currency:z.string().length(3).default("EUR"),cta:bounded(400).default(""),
 status:z.enum(["draft","verified","archived"]).default("draft"),
 source_id:z.uuid().nullable().optional()
});
// PATCH payloads must not inherit creation defaults: omitted fields are kept as-is.
export const offerPatchSchema=z.object({
 kind:z.enum(["product","service"]).optional(),name:bounded(180).min(1).optional(),
 description:bounded(12000).optional(),audience:bounded(3000).optional(),
 benefits:z.array(bounded(300)).max(20).optional(),
 price:z.number().nonnegative().max(99999999).nullable().optional(),
 currency:z.string().length(3).optional(),cta:bounded(400).optional(),
 status:z.enum(["draft","verified","archived"]).optional(),
 source_id:z.uuid().nullable().optional()
}).refine(x=>Object.keys(x).length>0);
export const campaignSchema=z.object({
 title:bounded(180).min(1),objective:bounded(3000).min(1),period:bounded(80).min(1),
 offer_id:z.uuid().nullable().optional()
});
export const missionSchema=z.object({
 request:bounded(3000).min(8),
 offer_id:z.uuid().nullable().optional(),
 period:bounded(80).default("Prossimi 30 giorni")
});
export const chatSchema=z.object({body:bounded(4000).min(1)});
export const signalSchema=z.object({
 platform:z.enum(["instagram","linkedin","website","review","support","other"]),
 kind:z.enum(["comment","question","objection","review","faq","dm","other"]),
 topic:bounded(160).min(2),
 excerpt:bounded(2500).min(5),
 audience_need:bounded(1000).default(""),
 context:bounded(1200).default(""),
 source_url:z.url().max(1500).refine(v=>/^https?:\/\//i.test(v),"Usa un riferimento http(s)").nullable().default(null),
 observed_at:z.iso.date().optional()
});
export const editorialBriefSchema=z.object({
 audience_need:bounded(800).default(""),
 hook:bounded(400).default(""),
 promise:bounded(700).default(""),
 value_delivered:bounded(800).default(""),
 emotional_angle:bounded(300).default(""),
 rational_proof:bounded(800).default(""),
 single_cta:bounded(300).default(""),
 community_signal_ids:z.array(z.uuid()).max(8).default([])
});
export const updateContentSchema=z.object({
 title:bounded(240).min(1).optional(),
 caption:bounded(12000).optional(),
 slides:z.array(z.object({
 headline:bounded(250),body:bounded(1200),
 visual_prompt:bounded(1200).optional(),image_path:bounded(500).optional(),
  layout:z.enum(["cover","content","quote","closing"]).optional()
 })).max(20).optional(),
 editorial_brief:editorialBriefSchema.optional(),
 status:z.enum(["draft","review","approved"]).optional()
});
export const uuid=z.uuid();
