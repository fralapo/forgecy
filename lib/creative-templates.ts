/** Forgecy V17: brand-neutral, static art-direction presets. All dimensions derive from the same specification. */
export const LAYOUTS=["classic","editorial","statement","split"] as const;
export type SlideLayout=(typeof LAYOUTS)[number];
export type CreativeSlide={
  headline:string;body:string;visual_prompt?:string;image_path?:string;layout?:SlideLayout
};
export type StaticChannel="instagram"|"linkedin";
export function resolveSlideLayout(value:unknown):SlideLayout{
 return typeof value==="string" && (LAYOUTS as readonly string[]).includes(value)
   ?value as SlideLayout:"classic";
}
export const LAYOUT_META:Record<SlideLayout,{label:string;description:string}>={
 classic:{label:"Classico",description:"Titolo e corpo ben leggibili"},
 editorial:{label:"Editoriale",description:"Gerarchia ariosa e filetto grafico"},
 statement:{label:"Manifesto",description:"Affermazione centrale di grande impatto"},
 split:{label:"Bicolore",description:"Pannello decorativo del brand"}
};
export function slideVisualSpec(layout:unknown,channel:StaticChannel,headlineLength=0){
 const id=resolveSlideLayout(layout);
 const width=channel==="linkedin"?1920:1080;
 const height=channel==="linkedin"?1080:1350;
 const safePad=channel==="linkedin"?124:82;
 const baseTitle=channel==="linkedin"?82:72;
 const baseBody=channel==="linkedin"?40:37;
 const longTitle=headlineLength>95?0.65:headlineLength>65?0.79:1;
 const titleScale={classic:1,editorial:.96,statement:1.24,split:1.02}[id];
 const bodyScale={classic:1,editorial:.92,statement:.85,split:.97}[id];
 return {
   id,width,height,padding:safePad,
   titlePx:Math.round(baseTitle*longTitle*titleScale),
   bodyPx:Math.round(baseBody*bodyScale),
   titleAlign:id==="statement"?"center":"left" as "center"|"left",
   position:id==="editorial"?"top":id==="statement"?"center":"center",
   accentBar:id==="editorial",
   frame:id==="statement",
   split:id==="split"
 };
}

export type CreativeWarning={index:number;code:string;severity:"warning"|"blocking";message:string};
/** Conservative preflight for static copy; this is NOT a replacement for real renderer bounds checks. */
export function creativeWarnings(slides:CreativeSlide[],channel:StaticChannel):CreativeWarning[]{
 const issues:CreativeWarning[]=[];
 for(let index=0;index<slides.length;index++){
   const slide=slides[index];
   const spec=slideVisualSpec(slide.layout,channel,slide.headline.length);
   const headline=slide.headline.trim(),body=slide.body.trim();
   if(!headline){
     issues.push({index,code:"empty_headline",severity:"blocking",message:"Titolo della slide obbligatorio"});
   }
   const titleLimit=spec.id==="statement"?110:channel==="linkedin"?125:95;
   if(headline.length>titleLimit)
     issues.push({index,code:"headline_dense",severity:"warning",
       message:"Titolo molto lungo per questo template: riduci il testo o controlla l'anteprima"});
   const bodyLimit=spec.id==="statement"?220:channel==="linkedin"?420:360;
   if(body.length>bodyLimit)
     issues.push({index,code:"body_dense",severity:"warning",
       message:"Corpo della slide denso: potrebbe eccedere l'area di sicurezza"});
   if(body.length>750)
     issues.push({index,code:"body_oversized",severity:"blocking",
       message:"Corpo troppo lungo per un'immagine statica: dividi in più slide"});
 }
 return issues;
}

export type SlideHistory={past:CreativeSlide[][];present:CreativeSlide[];future:CreativeSlide[][]};
export type SlideHistoryAction=
  |{type:"edit";slides:CreativeSlide[]}
  |{type:"undo"}|{type:"redo"}|{type:"reset";slides:CreativeSlide[]};
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
