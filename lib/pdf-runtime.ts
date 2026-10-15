import { sep } from "node:path";
import { pathToFileURL } from "node:url";
import { PDFParse } from "pdf-parse";
import type { PositionedPdfTextItem } from "./catalog-import";

/** Configure PDF.js' bundled OpenJPEG decoder so embedded JPEG2000 assets can render in Node. */
export function pdfWasmUrl() {
  // Keep the WASM runtime path out of Turbopack's static module graph: importing
  // the .wasm file directly makes Turbopack generate an unresolved loader.
  return pathToFileURL(`${process.cwd()}${sep}node_modules${sep}pdfjs-dist${sep}wasm${sep}`).href;
}

export async function createPdfParser(bytes: Uint8Array) {
  await import("pdf-parse/worker");
  return new PDFParse({ data: Uint8Array.from(bytes), wasmUrl: pdfWasmUrl() });
}

/** Read raw PDF.js text coordinates through pdf-parse's loaded document for layout-aware tables. */
export async function getPositionedPdfText(parser:Awaited<ReturnType<typeof createPdfParser>>,pageNumber:number):Promise<PositionedPdfTextItem[]>{
 // pdf-parse does not currently expose positioned text publicly; keep its internal access contained here.
 const runtime=parser as unknown as {doc?:{getPage(n:number):Promise<{getTextContent():Promise<{items:unknown[]}>}>}};
 if(!runtime.doc)throw new Error("PDF document has not been loaded");
 const page=await runtime.doc.getPage(pageNumber);
 const content=await page.getTextContent();
 return content.items.flatMap(item=>{
  if(!item||typeof item!=="object"||!("str" in item)||typeof item.str!=="string"||!("transform" in item)||!Array.isArray(item.transform))return [];
  const transform=item.transform as unknown[];
  const x=transform[4],y=transform[5];
  return typeof x==="number"&&typeof y==="number"?[{str:item.str,x,y}]:[];
 });
}

export type PdfImagePlacement={name:string;x:number;y:number;width:number;height:number};

/** Detect image-heavy page scans that can be hidden inside an otherwise text-readable PDF. */
export async function pageHasRasterizedContent(parser:Awaited<ReturnType<typeof createPdfParser>>,pageNumber:number):Promise<boolean>{
 const runtime=parser as unknown as {doc?:{getPage(n:number):Promise<{view?:number[]}>}};
 if(!runtime.doc)throw new Error("PDF document has not been loaded");
 const page=await runtime.doc.getPage(pageNumber);
 const view=page.view;
 if(!view||view.length<4)return false;
 const left=view[0]!,bottom=view[1]!,right=view[2]!,top=view[3]!;
 const pageArea=Math.abs((right-left)*(top-bottom));
 if(pageArea<=0)return false;
 const images=await getPdfImagePlacements(parser,pageNumber);
 const coveredArea=images.reduce((total,image)=>{
  const imageLeft=Math.max(left,image.x),imageBottom=Math.max(bottom,image.y);
  const imageRight=Math.min(right,image.x+image.width),imageTop=Math.min(top,image.y+image.height);
  return total+Math.max(0,imageRight-imageLeft)*Math.max(0,imageTop-imageBottom);
 },0);
 return coveredArea/pageArea>=0.45;
}

/** Read image placement boxes so catalog photos can be matched to nearby product rows. */
export async function getPdfImagePlacements(parser:Awaited<ReturnType<typeof createPdfParser>>,pageNumber:number):Promise<PdfImagePlacement[]>{
 const runtime=parser as unknown as {doc?:{getPage(n:number):Promise<{getOperatorList():Promise<{fnArray:number[];argsArray:unknown[][]}>}>}};
 if(!runtime.doc)throw new Error("PDF document has not been loaded");
 const page=await runtime.doc.getPage(pageNumber);
 const operators=await page.getOperatorList();
 const {OPS}=await import("pdfjs-dist/legacy/build/pdf.mjs");
 type Matrix=[number,number,number,number,number,number];
 const multiply=(left:Matrix,right:Matrix):Matrix=>[
  left[0]*right[0]+left[2]*right[1],left[1]*right[0]+left[3]*right[1],
  left[0]*right[2]+left[2]*right[3],left[1]*right[2]+left[3]*right[3],
  left[0]*right[4]+left[2]*right[5]+left[4],left[1]*right[4]+left[3]*right[5]+left[5],
 ];
 let transform:Matrix=[1,0,0,1,0,0];
 const stack:Matrix[]=[];
 const placements:PdfImagePlacement[]=[];
 for(let index=0;index<operators.fnArray.length;index++){
  const operation=operators.fnArray[index];
  if(operation===OPS.save){stack.push([...transform]);continue;}
  if(operation===OPS.restore){transform=stack.pop()||[1,0,0,1,0,0];continue;}
  if(operation===OPS.transform){
   const raw=operators.argsArray[index];
   if(Array.isArray(raw)&&raw.length===6&&raw.every(value=>typeof value==="number"))transform=multiply(transform,raw as Matrix);
   continue;
  }
  if(operation!==OPS.paintImageXObject)continue;
  const raw=operators.argsArray[index];
  const name=Array.isArray(raw)&&typeof raw[0]==="string"?raw[0]:null;
  if(!name)continue;
  const corners=[[0,0],[1,0],[0,1],[1,1]].map(([x,y])=>[
   transform[0]*x!+transform[2]*y!+transform[4],transform[1]*x!+transform[3]*y!+transform[5],
  ] as const);
  const xs=corners.map(point=>point[0]),ys=corners.map(point=>point[1]);
  const left=Math.min(...xs),bottom=Math.min(...ys),right=Math.max(...xs),top=Math.max(...ys);
  placements.push({name,x:left,y:bottom,width:right-left,height:top-bottom});
 }
 return placements;
}
