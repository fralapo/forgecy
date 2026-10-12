/** Shared, brand-independent slide layout contract used by editor and exports. */
export const SLIDE_LAYOUTS=["cover","content","quote","closing"] as const;
export type SlideLayout=(typeof SLIDE_LAYOUTS)[number];
export type SlideText={headline?:string;body?:string;layout?:SlideLayout};
export function resolvedLayout(value:unknown):SlideLayout{
 return typeof value==="string"&&SLIDE_LAYOUTS.includes(value as SlideLayout)?value as SlideLayout:"content";
}
export function layoutStyle(layout:SlideLayout){
 switch(layout){
  case "cover":return {textAlign:"left" as const,titleWeight:800,titleScale:1.15,label:"Copertina"};
  case "quote":return {textAlign:"center" as const,titleWeight:700,titleScale:0.93,label:"Citazione"};
  case "closing":return {textAlign:"center" as const,titleWeight:800,titleScale:1.04,label:"CTA"};
  default:return {textAlign:"left" as const,titleWeight:750,titleScale:1,label:"Contenuto"};
 }
}
export type PreflightIssue={severity:"warning"|"blocking";message:string};
export function slidePreflight(slide:SlideText):PreflightIssue[]{
 const layout=resolvedLayout(slide.layout);
 const head=(slide.headline||"").trim(),body=(slide.body||"").trim();
 const issues:PreflightIssue[]=[];
 if(!head)issues.push({severity:"blocking",message:"La slide non ha un titolo."});
 if(head.length>110)issues.push({severity:"warning",message:"Titolo molto lungo: verifica la leggibilità sul telefono."});
 if(body.length>480)issues.push({severity:"warning",message:"Testo oltre 480 caratteri: rischia di uscire dalla slide."});
 if(layout==="cover"&&head.split(/\s+/).length>18)
   issues.push({severity:"warning",message:"La copertina è troppo verbosa per catturare l'attenzione."});
 if(layout==="closing"&&!body)
   issues.push({severity:"warning",message:"La pagina finale dovrebbe indicare una prossima azione utile o conclusione."});
 return issues;
}
