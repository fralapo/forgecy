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
export const updateContentSchema=z.object({
 title:bounded(240).min(1).optional(),
 caption:bounded(12000).optional(),
 slides:z.array(z.object({
 headline:bounded(250),body:bounded(1200),
 visual_prompt:bounded(1200).optional(),image_path:bounded(500).optional()
 })).max(20).optional(),
 status:z.enum(["draft","review","approved"]).optional()
});
export const uuid=z.uuid();
