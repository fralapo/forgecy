import { z } from "zod";

export type CatalogProduct={
 name:string;description:string;price:number|null;currency:string;
 nameQuote:string;descriptionQuote:string;priceQuote:string;existingOfferId:string|null;imageIndex:number|null;
};

const productSchema=z.object({
 name:z.string().trim().min(2).max(180).default("Nome non verificato"),
 description:z.string().trim().max(1200).default(""),
 price:z.number().nonnegative().max(99_999_999).nullable().default(null),
 currency:z.string().length(3).default("EUR"),
 name_quote:z.string().max(500).default(""),
 description_quote:z.string().max(1200).default(""),
 price_quote:z.string().max(200).default(""),
 existing_offer_id:z.uuid().nullable().default(null),
 image_index:z.number().int().min(0).max(7).nullable().default(null)
}).strict();
export const catalogExtractionSchema=z.object({products:z.array(productSchema).max(40)}).strict();
/** The model response is parsed without a hard array ceiling, then capped before reconciliation. */
export const catalogExtractionModelSchema=z.object({products:z.array(productSchema)}).strict();
export type CatalogExtraction=z.infer<typeof catalogExtractionSchema>;

export function normalizeCatalogName(value:string){
 const normalized=value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("it")
  .replace(/(\d)\s+(ml|cl|dl|l|g|kg|mg|pz)\b/gu,"$1$2")
  .replace(/[^\p{L}\p{N}]+/gu," ").trim().replace(/\s+/g," ");
 const stopWords=new Set(["alla","alle","allo","agli","all","di","del","della","dei","delle","con","per","il","la","lo","i","gli","le","un","una","uno"]);
 return normalized.split(" ").filter(token=>!stopWords.has(token)).join(" ");
}

export function looksLikeCatalog(title:string,body:string){
 return /catalog|catalogo|listino|prodott|price[ -]?list|sku/i.test(title+"\n"+body)&&
  /\b(product|prodotto|prodotti|prezzo|price|€|sku|codice|codici|articolo|articoli|confezione)\b/i.test(body);
}

function parsePrice(value:string):number|null{
 const text=value.replace(/[^\d,.-]/g,"").trim();
 if(!text)return null;
 let normalized=text;
 if(text.includes(",")&&text.includes("."))normalized=text.lastIndexOf(",")>text.lastIndexOf(".")?text.replace(/\./g,"").replace(",","."):text.replace(/,/g,"");
 else if(text.includes(","))normalized=text.replace(",",".");
 const number=Number(normalized);
 return Number.isFinite(number)&&number>=0?number:null;
}

function parseCsv(input:string):string[][]{
 const text=input.replace(/^\uFEFF/,"");
 const firstLine=text.split(/\r?\n/,1)[0]||"";
 const delimiter=(firstLine.match(/;/g)?.length||0)>(firstLine.match(/,/g)?.length||0)?";":",";
 const rows:string[][]=[];let row:string[]=[],field="",quoted=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(ch==='"'&&quoted&&text[i+1]==='"'){field+='"';i++;continue;}
  if(ch==='"'){quoted=!quoted;continue;}
  if(ch===delimiter&&!quoted){row.push(field);field="";continue;}
  if((ch==="\n"||ch==="\r")&&!quoted){
   if(ch==="\r"&&text[i+1]==="\n")i++;
   row.push(field);if(row.some(cell=>cell.trim()))rows.push(row);row=[];field="";continue;
  }
  field+=ch;
 }
 row.push(field);if(row.some(cell=>cell.trim()))rows.push(row);
 return rows;
}

function headerIndex(headers:string[],aliases:string[]){
 return headers.findIndex(header=>{
  const normalized=normalizeCatalogName(header);
  return aliases.some(alias=>normalized===alias||normalized.startsWith(alias+" "));
 });
}

/** Deterministic fallback for spreadsheet-like CSV catalogs; every field retains its row as evidence. */
export function parseCsvCatalog(text:string):CatalogProduct[]{
 const rows=parseCsv(text);if(rows.length<2)return [];
 const headers=rows[0].map(normalizeCatalogName);
 const nameIndex=headerIndex(headers,["nome","nome prodotto","prodotto","product","product name","name","articolo","nome articolo","item"]);
 const descriptionIndex=headerIndex(headers,["descrizione","description","dettagli","details"]);
 const codeIndex=headerIndex(headers,["codice","code","sku","codice prodotto","product code"]);
 const segmentIndex=headerIndex(headers,["segmento","segment","categoria","category"]);
 const nameFromDescription=nameIndex<0&&descriptionIndex>=0&&codeIndex>=0;
 const priceIndex=headerIndex(headers,["prezzo","price","costo","listino"]);
 const currencyIndex=headerIndex(headers,["valuta","currency"]);
 if(nameIndex<0&&!nameFromDescription)return [];
 return rows.slice(1,1001).flatMap(cells=>{
  const name=(cells[nameFromDescription?descriptionIndex:nameIndex]||"").trim();if(name.length<2)return [];
  const codeAndSegment=[codeIndex>=0?cells[codeIndex]||"":"",segmentIndex>=0?cells[segmentIndex]||"":""].map(value=>value.trim()).filter(Boolean);
  const description=(nameFromDescription?codeAndSegment.join(" — "):descriptionIndex>=0?cells[descriptionIndex]||"":"").trim().slice(0,4000);
  const priceRaw=priceIndex>=0?cells[priceIndex]||"":"";
  const price=parsePrice(priceRaw);
  return [{name,description,price,currency:(currencyIndex>=0?cells[currencyIndex]||"EUR":"EUR").trim().toUpperCase().slice(0,3)||"EUR",
   nameQuote:name,descriptionQuote:nameFromDescription?JSON.stringify(codeAndSegment):description,priceQuote:price===null?"":priceRaw,
   existingOfferId:null,imageIndex:null}];
 });
}

function markdownCells(line:string):string[]|null{
 const trimmed=line.trim();
 if(!trimmed.startsWith("|")||!trimmed.endsWith("|"))return null;
 return trimmed.slice(1,-1).split(/(?<!\\)\|/u).map(cell=>cell.replace(/\\\|/gu,"|").trim());
}

/** Parse OCR-preserved Markdown tables locally when headers identify product names and prices. */
export function parseMarkdownCatalogTable(text:string):CatalogProduct[]{
 const lines=text.split(/\r?\n/u);
 const found:CatalogProduct[]=[];
 for(let headerLine=0;headerLine<lines.length-1;headerLine++){
  const headers=markdownCells(lines[headerLine]);
  const separators=markdownCells(lines[headerLine+1]);
  if(!headers||!separators||headers.length!==separators.length||!separators.every(cell=>/^:?-{3,}:?$/u.test(cell.replace(/\s/gu,""))))continue;
  const normalizedHeaders=headers.map(normalizeCatalogName);
  let nameIndex=headerIndex(normalizedHeaders,["nome","nome prodotto","prodotto","product","product name","name","articolo","nome articolo","item","modello","model"]);
  const priceIndex=headerIndex(normalizedHeaders,["prezzo listino","prezzo","price","costo","listino"]);
  if(priceIndex<0)continue;
  let descriptionIndex=headerIndex(normalizedHeaders,["descrizione","description","dettagli","details"]);
  const codeIndex=headerIndex(normalizedHeaders,["codice","code","sku","codice prodotto","product code"]);
  const segmentIndex=headerIndex(normalizedHeaders,["segmento","segment","categoria","category"]);
  const nameFromDescription=nameIndex<0&&descriptionIndex>=0&&codeIndex>=0;
  if(nameFromDescription){
   nameIndex=descriptionIndex;
   descriptionIndex=codeIndex;
  }
  if(nameIndex<0)continue;
  const currencyIndex=headerIndex(normalizedHeaders,["valuta","currency"]);
  const products:CatalogProduct[]=[];
  for(let rowLine=headerLine+2;rowLine<lines.length;rowLine++){
   const cells=markdownCells(lines[rowLine]);
   if(!cells||cells.length!==headers.length){if(products.length)break;continue;}
   const name=(cells[nameIndex]||"").trim();
   if(name.length<2||/^[-—–]+$/u.test(name))continue;
   const description=nameFromDescription
    ?[cells[codeIndex]||"",segmentIndex>=0?cells[segmentIndex]||"":""].map(value=>value.trim()).filter(Boolean).join(" — ").slice(0,1200)
    :(descriptionIndex>=0?cells[descriptionIndex]||"":"").trim().slice(0,1200);
   const priceQuote=(cells[priceIndex]||"").trim();
   const price=parsePrice(priceQuote);
   products.push({name,description,price,currency:(currencyIndex>=0?cells[currencyIndex]||"EUR":"EUR").trim().toUpperCase().slice(0,3)||"EUR",
    nameQuote:name,descriptionQuote:nameFromDescription?JSON.stringify([cells[codeIndex]||"",segmentIndex>=0?cells[segmentIndex]||"":""].map(value=>value.trim()).filter(Boolean)):description,priceQuote:price===null?"":priceQuote,existingOfferId:null,imageIndex:null});
  }
  found.push(...products);
  if(found.length>=1000)return found.slice(0,1000);
 }
 return found;
}

/** Parse OCR product cards: a short product heading, details, then a printed code/packaging block. */
export function parseMarkdownCatalogCards(text:string):CatalogProduct[]{
 const lines=text.split(/\r?\n/u);
 const headings=lines.flatMap((line,index)=>{
  const title=/^#\s+(.+?)\s*#*$/u.exec(line)?.[1]?.trim();
  return title?[{index,title}]:[];
 });
 const productStarts=headings.filter(({index,title})=>{
  const normalized=normalizeCatalogName(title);
  if(/^(?:campo d impiego|codici confezione|catalogo|listino|price list|descrizione|dosi|istruzioni d uso)$/u.test(normalized))return false;
  const next=lines.slice(index+1).find(line=>line.trim())?.trim()||"";
  return /^!\[img-\d+\.[^\]]+\]\(/iu.test(next)||/^#\s+\S/u.test(next);
 });
 if(productStarts.length<2)return [];
 const products:CatalogProduct[]=[];
 for(let index=0;index<productStarts.length;index++){
  const start=productStarts[index]!;
  const end=productStarts[index+1]?.index??lines.length;
  const block=lines.slice(start.index+1,end);
  const codeHeader=block.findIndex(line=>/^\s*(?:codici|codice)\s+(?:confezione|packaging)\s*$/iu.test(line.trim()));
  if(codeHeader<0)continue;
  const codeRows=block.slice(codeHeader+1).map(line=>line.trim()).filter(line=>/^((?=[A-Z0-9/-]*\d)[A-Z0-9][A-Z0-9/-]{4,})\s+\S/iu.test(line));
  if(!codeRows.length)continue;
  const detailTitle=headings.find(heading=>heading.index>start.index&&heading.index<end&&
   !/^(?:campo d impiego|codici confezione|catalogo|listino)$/u.test(normalizeCatalogName(heading.title)))?.title;
  const descriptionQuotes=[...(detailTitle?[detailTitle]:[]),...codeRows];
  const imageMatch=block.map(line=>/^\s*!\[img-(\d+)\.[^\]]+\]\(/iu.exec(line)).find(Boolean);
  const imageIndex=imageMatch?Number(imageMatch[1]):null;
  products.push({name:start.title,description:descriptionQuotes.join(" — "),price:null,currency:"EUR",
   nameQuote:start.title,descriptionQuote:JSON.stringify(descriptionQuotes),priceQuote:"",existingOfferId:null,
   imageIndex:imageIndex!==null&&imageIndex<=7?imageIndex:null});
 }
 return products.length===productStarts.length?products:[];
}

/** Parse OCR catalog variants where each product image is followed by a short label and a printed code. */
export function parseMarkdownImageVariants(text:string):CatalogProduct[]{
 const lines=text.split(/\r?\n/u);
 const firstImage=lines.findIndex(line=>/^\s*!\[img-\d+\.[^\]]+\]\(/iu.test(line));
 if(firstImage<0)return [];
 const familyHeading=lines.slice(0,firstImage).map(line=>/^#\s+(.+?)\s*#*$/u.exec(line)?.[1]?.trim()||"")
  .filter(heading=>heading.length>=5&&!/^(?:catalog(?:ue|o)?(?: products?)?|listino(?: prezzi)?|price list|document(?:o)?|pagina|page|scheda tecnica|technical specification|manuale d uso|indice|contents)(?:\s+\d{4})?$/iu.test(normalizeCatalogName(heading)))[0];
 if(!familyHeading)return [];
 const found:CatalogProduct[]=[];
 for(let i=firstImage;i<lines.length;i++){
  const match=/^\s*!\[img-(\d+)\.[^\]]+\]\(/iu.exec(lines[i]);
  if(!match)continue;
  const imageIndex=Number(match[1]);
  if(!Number.isInteger(imageIndex)||imageIndex>7)continue;
  const block:string[]=[];
  for(let j=i+1;j<lines.length&&!/^\s*(?:!\[img-|#{1,6}\s)/u.test(lines[j]);j++){
   const value=lines[j].trim();
   if(value)block.push(value);
  }
  const codeLine=block.find(value=>/\bcod(?:ice)?\.?\s*[A-Z0-9][A-Z0-9/-]{2,}/iu.test(value));
  if(!codeLine)continue;
  const variant=block.find(value=>value!==codeLine&&/\p{L}/u.test(value)&&value.length<=100&&!/^\d/u.test(value));
  if(!variant)continue;
  const code=/(?:cod(?:ice)?\.?\s*)([A-Z0-9][A-Z0-9/-]{2,})/iu.exec(codeLine)?.[1];
  if(!code)continue;
  const nameQuotes=[familyHeading,variant];
  found.push({name:`${familyHeading} ${variant}`,description:codeLine,price:null,currency:"EUR",
   nameQuote:JSON.stringify(nameQuotes),descriptionQuote:codeLine,priceQuote:"",existingOfferId:null,imageIndex});
 }
 return found;
}

export function catalogEvidenceIsValid(product:CatalogProduct,sourceText:string){
 const exact=(quote:string)=>!!quote&&sourceText.includes(quote);
 let nameQuotes=[product.nameQuote];
 try{
  const parsed:unknown=JSON.parse(product.nameQuote);
  if(Array.isArray(parsed)&&parsed.length>0&&parsed.every(quote=>typeof quote==="string"&&quote.trim()))
   nameQuotes=parsed as string[];
 }catch{/* Existing model output uses a single literal quote. */}
 let descriptionQuotes=[product.descriptionQuote];
 try{
  const parsed:unknown=JSON.parse(product.descriptionQuote);
  if(Array.isArray(parsed)&&parsed.length>0&&parsed.every(quote=>typeof quote==="string"&&quote.trim()))
   descriptionQuotes=parsed as string[];
 }catch{/* Existing model output uses a single literal quote. */}
 const normalizedName=normalizeCatalogName(product.name);
 return nameQuotes.every(exact)&&
   normalizeCatalogName(nameQuotes.join(" ")).includes(normalizedName)&&
   (product.description===""||(descriptionQuotes.every(exact)&&product.descriptionQuote.length>=Math.min(8,product.description.length)&&
    normalizeCatalogName(descriptionQuotes.join(" ")).includes(normalizeCatalogName(product.description))))&&
   (product.price===null||(exact(product.priceQuote)&&parsePrice(product.priceQuote)===product.price));
}

export function catalogNameSimilarity(left:string,right:string){
 const a=normalizeCatalogName(left),b=normalizeCatalogName(right);
 if(!a||!b)return 0;if(a===b)return 1;
 const leftTokens=new Set(a.split(" ")),rightTokens=new Set(b.split(" "));
 const overlap=[...leftTokens].filter(token=>rightTokens.has(token));
 if(overlap.length<2)return 0;
 return overlap.length/new Set([...leftTokens,...rightTokens]).size;
}
