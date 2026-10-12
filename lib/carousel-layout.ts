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

/** Editor history holds at most 30 snapshots, is reset after remote revision, and never writes to the server until Save. */
export type EditableSlide={headline:string;body:string;layout?:SlideLayout;visual_prompt?:string;image_path?:string};
export type SlideHistory={
 past:EditableSlide[][];present:EditableSlide[];future:EditableSlide[][];
};
export type SlideHistoryAction=
 |{type:"edit";slides:EditableSlide[]}
 |{type:"reset";slides:EditableSlide[]}
 |{type:"undo"}|{type:"redo"};
export function slideHistoryReducer(state:SlideHistory,action:SlideHistoryAction):SlideHistory{
 if(action.type==="reset")return {past:[],present:action.slides,future:[]};
 if(action.type==="undo"){
   if(!state.past.length)return state;
   return {past:state.past.slice(0,-1),present:state.past[state.past.length-1],
     future:[state.present,...state.future].slice(0,30)};
 }
 if(action.type==="redo"){
   if(!state.future.length)return state;
   return {past:[...state.past,state.present].slice(-30),present:state.future[0],
     future:state.future.slice(1)};
 }
 if(JSON.stringify(action.slides)===JSON.stringify(state.present))return state;
 return {past:[...state.past,state.present].slice(-30),present:action.slides,future:[]};
}
