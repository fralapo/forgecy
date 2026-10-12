export type AudienceSignal={id:string;topic:string;platform:string;source_url?:string|null;audience_need?:string|null};
export function audiencePatterns(signals:AudienceSignal[]){
 const grouped=new Map<string,AudienceSignal[]>();
 for(const s of signals){const k=s.topic.trim().toLocaleLowerCase("it-IT");if(!k)continue;grouped.set(k,[...(grouped.get(k)||[]),s]);}
 return [...grouped].map(([topic,items])=>{
 const refs=new Set(items.map(s=>s.source_url?.trim()).filter(Boolean));
 return {topic,observations:items.length,distinct_references:refs.size,kind:items.length===1?"isolated":refs.size>=2?"corroborated":"candidate",signal_ids:items.map(s=>s.id),needs:[...new Set(items.map(s=>s.audience_need).filter(Boolean))]};
 }).sort((a,b)=>b.distinct_references-a.distinct_references||b.observations-a.observations);
}
