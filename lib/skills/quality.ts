/** Deterministic format and traceability checks before model-based critique. */
export type StaticAsset={
 channel:"instagram"|"linkedin";
 format:"post"|"carousel"|"document";
 title:string;
 caption:string;
 slides:Array<{headline:string;body:string}>;
 editorial_brief:{
   audience_need:string;hook:string;promise:string;value_delivered:string;
   rational_proof:string;single_cta:string;community_signal_ids:string[]
 };
};
export type QualityIssue={code:string;severity:"blocking"|"review";message:string;item:number};
export function reviewStaticAssets(items:StaticAsset[],validSignals:ReadonlySet<string>,request=""):QualityIssue[]{
 const issues:QualityIssue[]=[];
 const add=(item:number,code:string,severity:QualityIssue["severity"],message:string)=>
  issues.push({item,code,severity,message});
 const excludesLinkedIn=/\b(?:evita|senza|escludi|non\s+(?:fare|creare|includere|produrre|usare|aggiungere|consegnare)(?:\s+[\p{L}\p{N}-]+){0,4})\s+(?:il\s+)?linkedin\b/iu.test(request);
 const instagramOnly=/\bsolo\s+instagram\b/i.test(request);
 if(!items.some(x=>x.channel==="instagram"))add(-1,"missing_instagram","blocking","Manca almeno un contenuto Instagram statico");
 if(!excludesLinkedIn&&!instagramOnly&&!items.some(x=>x.channel==="linkedin"))add(-1,"missing_linkedin","blocking","Manca almeno un adattamento LinkedIn");
 if((excludesLinkedIn||instagramOnly)&&items.some(x=>x.channel==="linkedin"))add(-1,"prohibited_linkedin","blocking","La richiesta esclude LinkedIn ma la proposta include contenuti LinkedIn");
 const exactCarouselCount=request.match(/(?:esattamente|exactly)\s+(\d+)\s+(?:carosell[io]|carousel(?:s)?)/i);
 const exactSlideCount=request.match(/(?:ciascun[oa]|each)\s+(?:di\s+)?(\d+)\s+(?:slide|pagine|pages)/i);
 if(exactCarouselCount){
  const expected=Number(exactCarouselCount[1]),actual=items.filter(x=>x.channel==="instagram"&&x.format==="carousel").length;
  if(actual!==expected)add(-1,"carousel_count","blocking",`La richiesta specifica ${expected} caroselli Instagram, la proposta ne contiene ${actual}`);
  const carouselOnly=/\b(?:non\s+(?:aggiungere|creare|includere|produrre)\s+(?:altri\s+)?(?:deliverable|formati|contenuti)|solo\s+(?:un|1)\s+carosello)\b/iu.test(request);
  if(carouselOnly&&items.some(x=>x.channel!=="instagram"||x.format!=="carousel"))
   add(-1,"unrequested_asset","blocking","La richiesta limita i deliverable al carosello Instagram, ma la proposta contiene altri formati o canali");
 }
 if(exactSlideCount){
  const expected=Number(exactSlideCount[1]);
  items.forEach((x,i)=>{if(x.channel==="instagram"&&x.format==="carousel"&&x.slides.length!==expected)add(i,"exact_slide_count","blocking",`La richiesta specifica ${expected} slide per carosello, questo ne contiene ${x.slides.length}`);});
 }
 for(let i=0;i<items.length;i++){
  const a=items[i],b=a.editorial_brief;
  if(a.channel==="instagram"&&a.format==="document"||a.channel==="linkedin"&&a.format==="carousel")
   add(i,"invalid_format","blocking","Il formato non appartiene al canale");
  if(!a.title.trim()||!a.caption.trim())add(i,"empty_copy","blocking","Titolo e didascalia devono essere compilati");
  if((a.format==="carousel"||a.format==="document")&&(a.slides.length<3||a.slides.length>8))
   add(i,"slide_count","blocking","Caroselli e documenti richiedono 3–8 pagine");
  if(a.format==="post"&&a.slides.length>1)add(i,"post_pages","review","Un post semplice non dovrebbe avere molte pagine");
  if(!b.audience_need.trim())add(i,"missing_audience","review","Manca il bisogno del pubblico");
  if(!b.hook.trim()||!b.promise.trim()||!b.value_delivered.trim())add(i,"unfulfilled_hook","review","Motiva gancio, promessa e valore realmente fornito");
  if(a.format!=="post"&&a.slides.some(x=>!x.headline.trim()))add(i,"empty_slide","blocking","Ogni pagina deve avere un titolo");
  for(const id of b.community_signal_ids){
   if(!validSignals.has(id))add(i,"unknown_signal","blocking","La proposta cita un'osservazione inesistente per questo cliente");
  }
  if(b.single_cta.length>300)add(i,"long_cta","review","La CTA è troppo articolata");
 }
 return issues;
}
