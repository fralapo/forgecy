import { z } from "zod";

export type CatalogProduct={
 name:string;description:string;price:number|null;currency:string;
 nameQuote:string;descriptionQuote:string;priceQuote:string;existingOfferId:string|null;imageIndex:number|null;
};
export type PositionedPdfTextItem={str:string;x:number;y:number};

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
 const titleOrBodySuggestsCatalog=/catalog|catalogo|listino|prodott|price[ -]?list|sku/i.test(title+"\n"+body)&&
  (/\b(product|prodott\w*|prezz[oi]|price|sku|codic\w*|articol\w*|confezion\w*)\b|\bcad\.?\b|\bprod\./i.test(body)||
   /(?:€|\bEUR\b)\s*\d|\b(?:cod\.?|art\.?)\s*\|/iu.test(body));
 if(titleOrBodySuggestsCatalog)return true;

 // Scanned price lists often omit “catalogo/listino” from their visible text
 // and arrive with generic filenames such as scan.pdf. Recognize explicit
 // Markdown price tables by their code + price headers and multiple SKU rows.
 const lines=body.split(/\r?\n/u);
 for(let index=0;index<lines.length-2;index++){
  const header=lines[index]||"";
  if(!/^\s*\|(?=.*\b(?:codice|articolo|sku|product\s*code)\b)(?=.*(?:€|\beur\b|prezzo|price)).*\|/iu.test(header))continue;
  const separator=lines[index+1]||"";
  if(!/^\s*\|\s*:?-{3,}:?\s*\|/u.test(separator))continue;
  let skuRows=0;
  for(let row=index+2;row<lines.length;row++){
   const line=lines[row]||"";
   if(!line.trim()){
    if(skuRows)break;
    continue;
   }
   if(!/^\s*\|/u.test(line)){if(skuRows)break;continue;}
   if(/\b[A-Z0-9][A-Z0-9.-]{4,}\b/iu.test(line)&&/(?:€|\bEUR\b)?\s*\d[\d.,]*/iu.test(line))skuRows++;
  }
  if(skuRows>=2)return true;
 }
 return false;
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
  return aliases.some(value=>{
   const alias=normalizeCatalogName(value);
   return normalized===alias||normalized.startsWith(alias+" ");
  });
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
 if(!trimmed.includes("|"))return null;
 const content=trimmed.replace(/^\|/u,"").replace(/\|$/u,"");
 const cells=content.split(/(?<!\\)\|/u).map(cell=>cell.replace(/\\\|/gu,"|").trim());
 return cells.length>=3?cells:null;
}

/** Parse OCR-preserved Markdown price lists and product matrices with exact row evidence. */
export function parseMarkdownCatalogTable(text:string):CatalogProduct[]{
 const lines=text.split(/\r?\n/u);
 const found:CatalogProduct[]=[];
 for(let headerLine=0;headerLine<lines.length-1;headerLine++){
  const headers=markdownCells(lines[headerLine]);
  if(!headers)continue;
  const separators=markdownCells(lines[headerLine+1]);
  const hasSeparator=Boolean(separators&&headers.length===separators.length&&separators.every(cell=>/^:?-{3,}:?$/u.test(cell.replace(/\s/gu,""))));
  const normalizedHeaders=headers.map(normalizeCatalogName);
  let nameIndex=headerIndex(normalizedHeaders,["nome","nome prodotto","prodotto","product","product name","name","articolo","nome articolo","item","modello","model"]);
  let priceIndex=headerIndex(normalizedHeaders,["prezzo listino","prezzo","price","costo","listino","eur"]);
  if(priceIndex<0)priceIndex=headers.findIndex(header=>/^(?:€|eur|euro)\s*\/\s*(?:cad\.?|pezzo|unità|unita)$/iu.test(header.trim()));
  if(priceIndex<0)priceIndex=headers.findIndex(header=>/^\s*€\s*$/u.test(header));
  let descriptionIndex=headerIndex(normalizedHeaders,["descrizione prodotto","descrizione","description","dettagli","details"]);
  const codeIndex=headerIndex(normalizedHeaders,["cod","codice","code","sku","codice prodotto","product code"]);
  const perItemPriceHeader=priceIndex>=0&&/^(?:€|eur|euro)\s*\/\s*(?:cad\.?|pezzo|unità|unita)$/iu.test(headers[priceIndex]!.trim());
  const perItemFamilyHeading=perItemPriceHeader?lines.slice(0,headerLine).reverse().map(line=>line.trim()).find(line=>/^[A-Z0-9]{3,8}\s+\p{L}/iu.test(line))||"":"";
  const segmentIndex=headerIndex(normalizedHeaders,["segmento","segment","categoria","category"]);
  const contentIndex=headerIndex(normalizedHeaders,["contenuto","content","formato","confezione","packaging"]);
  const barcodeIndex=headerIndex(normalizedHeaders,["barcode","ean","itf-14"]);
  const nameFromDescription=nameIndex<0&&descriptionIndex>=0&&codeIndex>=0;
  if(nameFromDescription){
   nameIndex=descriptionIndex;
   descriptionIndex=codeIndex;
  }
  const productByCode=nameIndex<0&&codeIndex>=0&&priceIndex>=0;
  if(productByCode)nameIndex=codeIndex;
  const variantIndex=productByCode?headerIndex(normalizedHeaders,["lunghezza","larghezza","dimensione","misura","taglia","variante","size","length","width"]):-1;
  const markdownFamilyHeading=productByCode?lines.slice(0,headerLine).reverse()
   .map(line=>/^\s*#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line)?.[1]?.trim()||"").find(Boolean)||"":"";
  const familyHeading=perItemFamilyHeading||markdownFamilyHeading;
  const productMatrix=priceIndex<0&&nameFromDescription&&contentIndex>=0;
  if(nameIndex<0||priceIndex<0&&!productMatrix||!hasSeparator&&!productMatrix&&!productByCode)continue;
  const currencyIndex=headerIndex(normalizedHeaders,["valuta","currency"]);
  const products:CatalogProduct[]=[];
  for(let rowLine=headerLine+(hasSeparator?2:1);rowLine<lines.length;rowLine++){
   const cells=markdownCells(lines[rowLine]);
   if(!cells||cells.length!==headers.length){if(products.length)break;continue;}
   const name=(cells[nameIndex]||"").trim();
   if(name.length<2||/^[-—–]+$/u.test(name))continue;
   const rowCode=codeIndex>=0?(cells[codeIndex]||"").trim():"";
   if((productMatrix&&!/(?=.*\d)[A-Z0-9][A-Z0-9./-]{2,}/iu.test(rowCode))||
      (productByCode&&!/(?=.*\d)[A-Z0-9][A-Z0-9./-]{5,}/iu.test(rowCode)))continue;
   const evidenceQuotes=nameFromDescription
    ?[rowCode,segmentIndex>=0?cells[segmentIndex]||"":"",contentIndex>=0?cells[contentIndex]||"":"",barcodeIndex>=0?cells[barcodeIndex]||"":""].map(value=>value.trim()).filter(Boolean)
    :[];
   const productCodeDescription=productByCode?cells.map((value,index)=>({value:value.trim(),index}))
    .filter(({value,index})=>value&&index!==codeIndex&&index!==priceIndex&&!/^!?\[?img-\d+\./iu.test(value))
    .map(({value})=>value):[];
   const dimensionalDescription=markdownFamilyHeading?headers.flatMap((header,index)=>
    /\b(?:lunghezza|larghezza|dimensione|misura|taglia|size|length|width)\b/iu.test(normalizedHeaders[index]||"")&&cells[index]?.trim()
     ?[{header:header.trim(),value:cells[index]!.trim()}]:[]):[];
   const description=nameFromDescription
    ?[rowCode,segmentIndex>=0?cells[segmentIndex]||"":"",contentIndex>=0?cells[contentIndex]||"":"",barcodeIndex>=0?cells[barcodeIndex]||"":""].map(value=>value.trim()).filter(Boolean).join(" — ").slice(0,1200)
    :productByCode&&dimensionalDescription.length?dimensionalDescription.map(item=>`${item.header}: ${item.value}`).join("; ").slice(0,1200)
     :productByCode?productCodeDescription.join(" — ").slice(0,1200):(descriptionIndex>=0?cells[descriptionIndex]||"":"").trim().slice(0,1200);
   const priceQuote=(cells[priceIndex]||"").trim();
   const price=parsePrice(priceQuote);
   if(productByCode&&price===null)continue;
   const imageReference=productByCode?cells.map(value=>/!?\[img-(\d+)\.[^\]]+\]\(/iu.exec(value)).find(Boolean):null;
   const imageIndex=imageReference?Number(imageReference[1]):null;
   const variantQuote=variantIndex>=0?(cells[variantIndex]||"").trim():"";
   const familyVariant=perItemFamilyHeading?(cells[0]||"").trim():variantQuote;
   const displayName=familyHeading&&productByCode?`${familyHeading}${familyVariant?` — ${familyVariant}`:""} (${name})`.slice(0,180):name;
   const nameQuote=familyHeading&&productByCode?JSON.stringify([familyHeading,...(familyVariant?[familyVariant]:[]),name]):name;
   const descriptionQuote=productByCode&&dimensionalDescription.length?JSON.stringify(dimensionalDescription.flatMap(item=>[item.header,item.value]))
    :nameFromDescription?JSON.stringify(evidenceQuotes):productByCode?JSON.stringify(productCodeDescription):description;
   products.push({name:displayName,description,price,currency:(currencyIndex>=0?cells[currencyIndex]||"EUR":"EUR").trim().toUpperCase().slice(0,3)||"EUR",
    nameQuote,descriptionQuote,
    priceQuote:price===null?"":priceQuote,existingOfferId:null,imageIndex:imageIndex!==null&&imageIndex<=7?imageIndex:null});
  }
  found.push(...products);
  if(found.length>=1000)return found.slice(0,1000);
 }
 return found;
}

/** Parse code-by-width matrices; their prices require independent verification. */
export function parseMarkdownVariantPriceMatrices(text:string):CatalogProduct[]{
 const lines=text.split(/\r?\n/u);
 const products:CatalogProduct[]=[];
 const seen=new Set<string>();
 let widths:string[]=[];
 let unit="";
 let matrixColumnStart=0;
 let activeImage:number|null=null;
 let plainWidths:string[]=[];
 let plainUnit="";
 let plainCode="";
 const addPlainVariants=(code:string)=>{
  if(!code||!plainWidths.length||!plainUnit)return;
  for(const width of plainWidths){
   if(!width)continue;
   const identity=`${normalizeCatalogName(code)}|${normalizeCatalogName(width)}|${plainUnit.toLowerCase()}`;
   if(seen.has(identity))continue;
   seen.add(identity);
   const name=`${code} — ${width} ${plainUnit}`.slice(0,180);
   products.push({name,description:`${width} ${plainUnit}`,price:null,currency:"EUR",
    nameQuote:JSON.stringify([code,width,plainUnit]),descriptionQuote:JSON.stringify([width,plainUnit]),
    priceQuote:"",existingOfferId:null,imageIndex:activeImage});
  }
 };
 for(const line of lines){
  const trimmed=line.trim();
  const imageMatch=/^!?\[img-(\d+)\.[^\]]+\]\(/iu.exec(trimmed);
  if(imageMatch){const index=Number(imageMatch[1]);activeImage=index<=7?index:null;continue;}
  const cells=markdownCells(trimmed);
  if(cells){
   if(cells.every(cell=>/^:?-{3,}:?$/u.test(cell.replace(/\s/gu,""))))continue;
   const widthColumn=cells.findIndex(cell=>/^largh/u.test(normalizeCatalogName(cell)));
   if(widthColumn>=0&&cells.length>=widthColumn+4){
    matrixColumnStart=widthColumn;
    unit=(cells[widthColumn+1]||"").trim();
    widths=cells.slice(widthColumn+2).map(value=>value.trim());
    while(widths.at(-1)==="")widths.pop();
    continue;
   }
   const code=(cells[matrixColumnStart]||"").trim();
   const isProductCode=/^(?=.*[\p{L}])(?=.*\d)[A-Z0-9]+(?:\s+[A-Z0-9]{1,8}){0,2}$/iu.test(code);
   const isUnitPrice=/^cad\.?$/iu.test((cells[matrixColumnStart+1]||"").trim());
   if(!isProductCode||!isUnitPrice||!widths.length||!unit)continue;
   for(let index=0;index<widths.length;index++){
    const width=widths[index]!;
    if(!width)continue;
    const identity=`${normalizeCatalogName(code)}|${normalizeCatalogName(width)}|${unit.toLowerCase()}`;
    if(seen.has(identity))continue;
    seen.add(identity);
    const name=`${code} — ${width} ${unit}`.slice(0,180);
    // OCR matrix cells are spatially aligned in the original page, but OCR can
    // omit repeated values without leaving a detectable column-count mismatch.
    // Import the evidenced product/size and leave the price for verification.
    products.push({name,description:`${width} ${unit}`,price:null,currency:"EUR",
     nameQuote:JSON.stringify([code,width,unit]),descriptionQuote:JSON.stringify([width,unit]),
     priceQuote:"",existingOfferId:null,imageIndex:activeImage});
   }
   continue;
  }
  const plainHeader=/^Larg(?:h(?:e)?)?\.?\s+(.+)$/iu.exec(trimmed);
  if(plainHeader){
   const headerContent=plainHeader[1]!.trim();
   if(/^(?=.*[\p{L}])(?=.*\d)[A-Z0-9]+(?:\s+[A-Z0-9]{1,8}){0,2}$/iu.test(headerContent)){
    plainCode=headerContent;
    continue;
   }
   const dimensions=/^(\S+)\s+(?:Cad\.?\s+)?(.+)$/iu.exec(headerContent);
   if(dimensions&&/^mm$/iu.test(dimensions[1]!)){
    plainUnit=dimensions[1]!.trim();
    plainWidths=dimensions[2]!.trim().split(/\s+/u).filter(value=>/^\d+(?:[.,]\d+)?$/u.test(value));
    addPlainVariants(plainCode);
    continue;
   }
   const legacyDimensions=/^(\S+)\s+(.+)$/u.exec(headerContent);
   if(legacyDimensions){
    plainUnit=legacyDimensions[1]!.trim();
    plainWidths=legacyDimensions[2]!.trim().split(/\s+/u);
   }
   continue;
  }
  const splitUnitHeader=/^mm\s+Cad\.?\s+(.+)$/iu.exec(trimmed);
  if(splitUnitHeader){
   plainUnit="mm";
   plainWidths=splitUnitHeader[1]!.trim().split(/\s+/u).filter(value=>/^\d+(?:[.,]\d+)?$/u.test(value));
   addPlainVariants(plainCode);
   continue;
  }
  const plainPriceRow=/^((?=.*[\p{L}])(?=.*\d)[A-Z0-9]+(?:\s+[A-Z0-9]{1,8}){0,2})\s+Cad\.?\s+(.+)$/iu.exec(trimmed);
  if(plainPriceRow&&plainWidths.length&&plainUnit){
   const code=plainPriceRow[1]!.trim();
   addPlainVariants(code);
   continue;
  }
  const codeHeading=/^(?=.*[\p{L}])(?=.*\d)[A-Z0-9]+(?:\s+[A-Z0-9]{1,8}){0,2}$/iu.test(trimmed);
  if(codeHeading){plainCode=trimmed;plainWidths=[];plainUnit="";activeImage=null;}
 }
 return products.slice(0,1000);
}

/** Parse OCR product cards whose printed SKU and `Cad.` price share a small table row. */
export function parseMarkdownCatalogCodePriceCards(text:string):CatalogProduct[]{
 const isCode=(value:string)=>/^(?:(?=.*[\p{L}])(?=.*\d)[A-Z0-9][A-Z0-9./-]*(?:\s+[A-Z0-9]{1,8}){0,2}|\d{4,14})$/iu.test(value.trim());
 const lines=text.split(/\r?\n/u);
 const products:CatalogProduct[]=[];
 const seen=new Set<string>();
 let headingCode="";
 let imageIndex:number|null=null;
 let evidence:string[]=[];
 for(const line of lines){
  const heading=/^\s*#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line)?.[1]?.trim()||"";
  if(heading){
   if(isCode(heading)){headingCode=heading;imageIndex=null;evidence=[];}
   else if(headingCode)evidence.push(heading);
   continue;
  }
  const image=/^\s*!\[img-(\d+)\.[^\]]+\]\(/iu.exec(line);
  if(image){const index=Number(image[1]);if(index<=7&&headingCode)imageIndex=index;continue;}
  const cells=markdownCells(line);
  if(cells){
   if(cells.every(cell=>/^:?-{3,}:?$/u.test(cell.replace(/\s/gu,""))))continue;
   const code=(cells[0]||"").trim();
   const unit=(cells[1]||"").trim();
   const priceQuote=(cells.at(-1)||"").trim();
   if(headingCode&&isCode(code)&&/^(?:cad\.?|la\s+conf\.?)$/iu.test(unit)){
    const price=parsePrice(priceQuote);
    if(price!==null){
     const identity=`${normalizeCatalogName(code)}|${priceQuote}`;
     if(!seen.has(identity)){
      seen.add(identity);
      const usefulEvidence=evidence.filter(value=>value.trim()).slice(-24);
      const description=usefulEvidence.join(" — ").slice(0,1200);
      products.push({name:code,description,price,currency:"EUR",nameQuote:code,
       descriptionQuote:JSON.stringify(usefulEvidence),priceQuote,existingOfferId:null,
       imageIndex:normalizeCatalogName(code)===normalizeCatalogName(headingCode)?imageIndex:null});
     }
    }
    evidence=[];
    continue;
   }
   // Preserve property labels and values as separate literal evidence.
   evidence.push(...cells.filter(Boolean));
   continue;
  }
  const plain=line.trim();
  if(plain&&!/^\[Pagine PDF\b/iu.test(plain))evidence.push(plain.replace(/^\s*#{1,6}\s+/u,""));
 }
 return products.slice(0,1000);
}

export function hasVariantPriceMatrix(text:string){
 const markdownHeader=/^\s*\|[^\n]*\bLarg(?:h(?:e)?)?\b[^\n]*\bmm\b/imu.test(text);
 const markdownPrice=/^\s*\|[^\n]*\bCad\.?\b/mu.test(text);
 const plainHeader=/^\s*Larg(?:h(?:e)?)?\.?\s+\S+\s+/imu.test(text);
 const plainPrice=/^\s*(?=.*[\p{L}])(?=.*\d)[A-Z0-9]+(?:\s+[A-Z0-9]{1,8}){0,2}\s+Cad\.?\s+/imu.test(text);
 return (markdownHeader&&markdownPrice)||(plainHeader&&plainPrice);
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

/** Estrae tabelle PDF testuali in cui il layout dispone le colonne su righe separate. */
export function parseNativeCatalogRows(text:string):CatalogProduct[]{
 const lines=text.split(/\r?\n/u).map(line=>line.trim());
 const codeHeader=lines.findIndex(line=>/^(?:cod\.?|codice|code|sku)$/iu.test(line));
 const descriptionHeader=lines.findIndex((line,index)=>index>=codeHeader&&index<=codeHeader+24&&
  /^(?:descrizione prodotto|descrizione|product description)$/iu.test(line));
 if(codeHeader<0||descriptionHeader<0)return [];
 const products:CatalogProduct[]=[];
 for(let index=descriptionHeader+1;index<lines.length;index++){
  const code=lines[index];
  if(!/^(?:(?:[A-Z]{1,8}[ -]?)\d{3,10}[A-Z]?|\d{5,10})$/iu.test(code))continue;
  const following=lines.slice(index+1).filter(Boolean).slice(0,3);
  const name=following.find(value=>/\p{L}{3}/u.test(value)&&!/^\d/u.test(value)&&value.length<=180);
  if(!name)continue;
  const packageSize=following.find(value=>/^\d+(?:[,.]\d+)?\s*(?:ml|cl|l|lt|g|gr|kg|pz)\b/iu.test(value));
  const descriptionQuotes=[code,...(packageSize?[packageSize]:[])];
  products.push({name,description:descriptionQuotes.join(" — "),price:null,currency:"EUR",
   nameQuote:name,descriptionQuote:JSON.stringify(descriptionQuotes),priceQuote:"",existingOfferId:null,imageIndex:null});
 }
 return products;
}

/** Parse native PDF tables with a product-family header and inline code/price rows. */
export function parseNativeCodePriceRows(title:string,text:string):CatalogProduct[]{
 if(!looksLikeCatalog(title,text))return [];
 const lines=text.split(/\r?\n/u).map(line=>line.trim()).filter(Boolean);
 const families=lines.flatMap((line,index)=>{
  const cells=line.split("\t").map(value=>value.trim());
  const fields=cells.map(normalizeCatalogName);
  const hasPriceTableHeader=fields.some(value=>/^(?:prezzo|prezzo listino|listino)$/u.test(value))&&fields.some(value=>/^(?:codice|cod|sku)$/u.test(value));
  const candidate=cells[0]||"";
  const hasTechnicalTableHeader=/\b(?:potenza|portata|alimentazione|scop|seer|cop|eer)\b/iu.test(cells.slice(1).join(" "));
  if(!hasPriceTableHeader&&!hasTechnicalTableHeader)return [];
  const normalized=normalizeCatalogName(candidate);
  if(!candidate||/^(?:codice|prezzo|accessori|catalogo|listino|sistemi ibridi|pompe di calore|caldaie|climatizzazione)$/iu.test(normalized)||
   /\b(?:a\d+w\d+|eer|cop|scop|seer)\b/iu.test(candidate))return [];
  return [{index,name:candidate}];
 });
 const products:CatalogProduct[]=[];
 const seen=new Set<string>();
 for(let index=0;index<lines.length&&products.length<1000;index++){
  const line=lines[index]!;
  const codePattern=/\b(?=[A-Z0-9/-]{5,14}\b)(?=[A-Z0-9/-]*\d)[A-Z0-9][A-Z0-9/-]{4,13}\b/iu;
  const codeMatch=codePattern.exec(line);
  if(!codeMatch)continue;
  const pricePattern=/(?<![\d,])\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)/gu;
  const priceMatch=[...line.matchAll(pricePattern)].find(match=>(match.index??-1)>codeMatch.index);
  if(!priceMatch)continue;
  const cells=line.split("\t").map(value=>value.trim());
  const codeCell=cells.findIndex(value=>value.includes(codeMatch[0]));
  if(codeCell<0)continue;
  const rowLabel=cells.slice(0,codeCell).find(value=>value&&value!=="•")||"";
  if(!rowLabel||!/[\p{L}\d]/u.test(rowLabel))continue;
  const family=[...families].reverse().find(header=>header.index<index&&index-header.index<=80)?.name||"";
  const code=codeMatch[0];
  const identity=`${family}\n${rowLabel}\n${code}\n${priceMatch[0]}`;
  if(seen.has(identity))continue;
  seen.add(identity);
  const name=`${family?`${family} `:""}${rowLabel} (${code})`.slice(0,180);
  const nameEvidence=[...(family?[family]:[]),rowLabel,code];
  const descriptionEvidence=[rowLabel,code];
  products.push({name,description:descriptionEvidence.join(" — "),price:parsePrice(priceMatch[0]),currency:"EUR",
   nameQuote:JSON.stringify(nameEvidence),descriptionQuote:JSON.stringify(descriptionEvidence),priceQuote:priceMatch[0],
   existingOfferId:null,imageIndex:null});
 }
 return products;
}

/** Parse native PDF product cards whose code, unit, and single price share a text line. */
export function parseNativeInlineCodePriceRows(title:string,text:string):CatalogProduct[]{
 if(!looksLikeCatalog(title,text))return [];
 const lines=text.split(/\r?\n/u);
 const products:CatalogProduct[]=[];
 const seen=new Set<string>();
 const rowPattern=/^\s*([A-Z0-9][A-Z0-9/-]{3,13})\s+(Cad\.?|La conf\.?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/iu;
 for(let index=0;index<lines.length;index++){
  const line=lines[index]||"";
  const row=rowPattern.exec(line);
  if(!row)continue;
  const code=row[1]!;
  const priceQuote=row[3]!;
  const family=lines.slice(Math.max(0,index-80),index).reverse().map(value=>value.trim())
   .map(value=>value.replace(/^\d{3,4}\s+/u,"").replace(/\s*\([^)]*\)\s*$/u,""))
   .find(value=>value.length>=5&&value.length<=120&&/\p{L}{4}/u.test(value)
    &&value===value.toLocaleUpperCase("it")
    &&!/^(?:PREZZI|CATALOGO|LISTINO|CODICE|DESCRIZIONE)(?:\s|$)/u.test(value)
    &&!/^(?=.*\d)[A-Z0-9/-]{4,14}$/u.test(value))||"";
  if(!family)continue;
  const identity=`${normalizeCatalogName(family)}|${code.toLocaleUpperCase("en-US")}|${priceQuote}`;
  if(seen.has(identity))continue;
  seen.add(identity);
  const name=`${family} (${code})`.slice(0,180);
  const nameEvidence=[family,code];
  products.push({name,description:`${family} — ${row[2]}`,price:parsePrice(priceQuote),currency:"EUR",
   nameQuote:JSON.stringify(nameEvidence),descriptionQuote:JSON.stringify([family,row[2]]),priceQuote,
   existingOfferId:null,imageIndex:null});
 }
 return products;
}

/** Parse native PDF price tables whose header and rows are tab-separated. */
export function parseNativeDimensionPriceTables(title:string,text:string):CatalogProduct[]{
 if(!looksLikeCatalog(title,text))return [];
 const lines=text.split(/\r?\n/u);
 const products:CatalogProduct[]=[];const seen=new Set<string>();
 for(let headerLine=0;headerLine<lines.length;headerLine++){
  const headers=(lines[headerLine]||"").split("\t").map(value=>value.trim());
  const normalized=headers.map(normalizeCatalogName);
  const codeIndex=headerIndex(normalized,["codice","cod","sku"]);
  const dimensionIndices=headers.flatMap((header,index)=>/\b(?:lunghezza|larghezza|dimensione|misura|taglia|size|length|width)\b/iu.test(normalized[index]||"")?[index]:[]);
  if(codeIndex<0||dimensionIndices.length===0||!headers.some(header=>/^(?:€|eur|euro|prezzo|listino)$/iu.test(header)))continue;
  const family=lines.slice(Math.max(0,headerLine-40),headerLine).reverse().map(line=>{
   const candidate=line.trim().split(/\s+\.\s+(?=\p{Lu})/u,1)[0]!.trim();
   return candidate===candidate.toLocaleUpperCase("it")&&/[\p{Lu}]{2}/u.test(candidate)&&candidate.length<=100?candidate:"";
  }).find(candidate=>candidate&&!/^(?:FLESSOMETRI|CODICE|LISTINO|CATALOGO|ACCESSORI)$/iu.test(normalizeCatalogName(candidate)))||"";
  if(!family)continue;
  let rowCount=0;
  for(let rowLine=headerLine+1;rowLine<lines.length;rowLine++){
   const cells=(lines[rowLine]||"").split("\t").map(value=>value.trim());
   if(cells.length<headers.length){if(rowCount)break;continue;}
   const code=cells[codeIndex]||"";
   if(!/^(?=.*\d)[A-Z0-9][A-Z0-9./-]{4,}$/iu.test(code))continue;
   const priceMatches=[...cells.slice(codeIndex+1).join(" ").matchAll(/(?<![\d,])(\d{1,3}(?:\.\d{3})*,\d{2})(?!\d)/gu)];
   if(priceMatches.length!==1)continue;
   const dimensions=dimensionIndices.map(index=>({header:headers[index]!,value:cells[index]||""})).filter(item=>item.value);
   if(dimensions.length!==dimensionIndices.length)continue;
   const name=`${family} — ${dimensions.map(item=>item.value).join(" × ")} (${code})`.slice(0,180);
   const identity=normalizeCatalogName(name);
   if(seen.has(identity))continue;
   seen.add(identity);rowCount++;
   const description=dimensions.map(item=>`${item.header}: ${item.value}`).join("; ").slice(0,1200);
   const dimensionQuotes=dimensions.flatMap(item=>[item.header,item.value]);
   products.push({name,description,price:parsePrice(priceMatches[0]![1]!),currency:"EUR",
   nameQuote:JSON.stringify([family,...dimensions.map(item=>item.value),code]),descriptionQuote:JSON.stringify(dimensionQuotes),
    priceQuote:priceMatches[0]![1]!,existingOfferId:null,imageIndex:null});
  }
 }
 return products;
}

/** Parse native text PDFs with aligned Code / Description / Segment / Price columns. */
export function parseNativeAlignedCodeSegmentPriceRows(title:string,text:string):CatalogProduct[]{
 if(!looksLikeCatalog(title,text))return [];
 const lines=text.split(/\r?\n/u);
 const header=lines.findIndex(line=>/^\s*Codice\s{2,}Descrizione\s{2,}Segmento\s{2,}Prezzo\s*€/iu.test(line));
 if(header<0)return [];
 const products:CatalogProduct[]=[];
 for(const line of lines.slice(header+1)){
  const cells=line.trim().split(/\s{2,}/u);
  if(cells.length!==4||!/^\d{6,10}$/u.test(cells[0]||""))continue;
  const [code,name,segment,priceQuote]=cells as [string,string,string,string];
  if(name.length<2||name.length>180||segment.length<2||segment.length>120
   ||!/^(?:\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})$/u.test(priceQuote))continue;
  const price=parsePrice(priceQuote);
  if(price===null)continue;
  products.push({name,description:`${code} — ${segment}`,price,currency:"EUR",
   nameQuote:name,descriptionQuote:JSON.stringify([code,segment]),priceQuote,
   existingOfferId:null,imageIndex:null});
 }
 return products.length>=2?products.slice(0,1000):[];
}

/** Parse OCR family headings followed by repeated variant-label and `Cod.` lines. */
export function parseMarkdownCatalogCodeVariants(text:string):CatalogProduct[]{
 const lines=text.split(/\r?\n/u);
 const headings=lines.flatMap((line,index)=>{
  const match=/^\s*#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line);
  return match?[{index,title:match[1]!.trim()}]:[];
 });
 const products:CatalogProduct[]=[];
 const seen=new Set<string>();
 for(let headingIndex=0;headingIndex<headings.length;headingIndex++){
  const heading=headings[headingIndex]!;
  if(/^(?:campo d impiego|codici confezione|catalogo|listino|price list|descrizione|dosi|istruzioni d uso)$/u.test(normalizeCatalogName(heading.title)))continue;
  const sectionEnd=headings[headingIndex+1]?.index??lines.length;
  const pairs:Array<{variant:string;codeLine:string;imageIndex:number|null}>=[];
  let previousCodeIndex=heading.index;
  for(let lineIndex=heading.index+1;lineIndex<sectionEnd;lineIndex++){
   const codeMatch=/^\s*cod(?:ice)?\.?\s*(?:articolo\s*)?:?\s*([A-Z0-9][A-Z0-9/-]{3,19})\s*$/iu.exec(lines[lineIndex]!);
   if(!codeMatch)continue;
   let variantIndex=lineIndex-1;
   while(variantIndex>previousCodeIndex&&(!lines[variantIndex]!.trim()||/^\s*!\[img-\d+\.[^\]]+\]\(/iu.test(lines[variantIndex]!)))variantIndex--;
   const variant=lines[variantIndex]?.trim()||"";
   previousCodeIndex=lineIndex;
   if(!variant||variantIndex<=heading.index||variant.length>120||!/[\p{L}]/u.test(variant)||/^#{1,6}\s/u.test(variant))continue;
   let imageIndex:number|null=null;
   for(let imageLine=variantIndex-1;imageLine>heading.index;imageLine--){
    if(/^\s*cod(?:ice)?\.?\s*(?:articolo\s*)?:?\s*[A-Z0-9][A-Z0-9/-]{3,19}\s*$/iu.test(lines[imageLine]!))break;
    const imageMatch=/^\s*!\[img-(\d+)\.[^\]]+\]\(/iu.exec(lines[imageLine]!);
    if(imageMatch){const index=Number(imageMatch[1]);if(index<=7)imageIndex=index;break;}
   }
   pairs.push({variant,codeLine:lines[lineIndex]!.trim(),imageIndex});
  }
  if(pairs.length<2)continue;
  for(const pair of pairs){
   const code=/(?:cod(?:ice)?\.?\s*(?:articolo\s*)?:?\s*)([A-Z0-9][A-Z0-9/-]{3,19})/iu.exec(pair.codeLine)?.[1];
   if(!code)continue;
   const name=`${heading.title} — ${pair.variant}`;
   const identity=normalizeCatalogName(name)+"|"+code.toLocaleUpperCase("en-US");
   if(seen.has(identity))continue;
   seen.add(identity);
   products.push({name,description:`${pair.variant} — ${pair.codeLine}`,price:null,currency:"EUR",
    nameQuote:JSON.stringify([heading.title,pair.variant]),descriptionQuote:JSON.stringify([pair.variant,pair.codeLine]),
    priceQuote:"",existingOfferId:null,imageIndex:pair.imageIndex});
  }
 }
 return products;
}

/** Parse deterministic catalog formats before asking an AI model to interpret the document. */
export function parseLocalCatalogProducts(title:string,text:string):CatalogProduct[]{
 const csvProducts=parseCsvCatalog(text);
 if(csvProducts.length)return csvProducts;
 const markdownProducts=looksLikeCatalog(title,text)?parseMarkdownCatalogTable(text):[];
 const matrixProducts=parseMarkdownVariantPriceMatrices(text);
 // Matrix rows use separate width and price lines, which OCR can misalign even
 // when both lines have the same cell count. Prefer the conservative matrix
 // result and never let the generic table parser persist those prices.
 if(matrixProducts.length)return matrixProducts.slice(0,1000);
 const codePriceCards=parseMarkdownCatalogCodePriceCards(text);
 if(codePriceCards.length)return codePriceCards.slice(0,1000);
 if(markdownProducts.length)return markdownProducts.slice(0,1000);
 const markdownCodeVariants=/catalog|catalogo|listino|price[ -]?list/i.test(title)?parseMarkdownCatalogCodeVariants(text):[];
 if(markdownCodeVariants.length)return markdownCodeVariants;
 const catalogCards=parseMarkdownCatalogCards(text);
 if(catalogCards.length)return catalogCards;
 const nativeDimensionProducts=parseNativeDimensionPriceTables(title,text);
 if(nativeDimensionProducts.length)return nativeDimensionProducts;
 const nativeSegmentedPriceProducts=parseNativeAlignedCodeSegmentPriceRows(title,text);
 if(nativeSegmentedPriceProducts.length)return nativeSegmentedPriceProducts;
 const nativeRows=looksLikeCatalog(title,text)?parseNativeCatalogRows(text):[];
 if(nativeRows.length)return nativeRows;
 const nativePricedRows=parseNativeCodePriceRows(title,text);
 if(nativePricedRows.length)return nativePricedRows;
 const nativeInlinePricedRows=parseNativeInlineCodePriceRows(title,text);
 if(nativeInlinePricedRows.length)return nativeInlinePricedRows;
 return looksLikeCatalog(title,text)?parseMarkdownImageVariants(text):[];
}

/** Recover priced rows from native PDF coordinates when plain-text order loses table columns. */
export function parsePositionedNativeCatalogRows(title:string,items:PositionedPdfTextItem[]):CatalogProduct[]{
 if(!/catalog|catalogo|listino|price[ -]?list/i.test(title))return [];
 const rows=items.filter(item=>item.str.trim()&&Number.isFinite(item.x)&&Number.isFinite(item.y))
  .map(item=>({...item,str:item.str.trim()}));
 const products:CatalogProduct[]=[];const seen=new Set<string>();
 // Caleffi's native VMC lists are two side-by-side tables, with code, name and
 // price placed by coordinates instead of tabs. Read each AIR row within its
 // own column so numeric page/category cells cannot be mistaken for prices.
 const airCodes=rows.filter(item=>/^AIR[A-Z]?\d{4,7}(?:\s+[A-Z0-9]{2,4})?$/iu.test(item.str))
  .sort((a,b)=>b.y-a.y||a.x-b.x);
 for(const code of airCodes){
  const sameLine=rows.filter(item=>Math.abs(item.y-code.y)<=0.75&&item.x>=code.x&&item.x<code.x+245).sort((a,b)=>a.x-b.x);
  const priceItems=sameLine.filter(item=>item.x>code.x&&/(?<![\d,])\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)/u.test(item.str));
  if(priceItems.length!==1)continue;
  const priceItem=priceItems[0]!;
  const priceMatch=/(?<![\d,])(\d{1,3}(?:\.\d{3})*,\d{2})(?!\d)/u.exec(priceItem.str);
  if(!priceMatch)continue;
  const description=sameLine.filter(item=>item.x>code.x&&item.x<priceItem.x&&item.str!=="•")
   .map(item=>item.str).join(" ").replace(/\s+/gu," ").trim();
  if(description.length<3||description.length>180)continue;
  const identity=`${code.str}|${description}|${priceMatch[1]}`;
  if(seen.has(identity))continue;
  seen.add(identity);
  products.push({name:description,description:code.str,price:parsePrice(priceMatch[1]),currency:"EUR",
   nameQuote:description,descriptionQuote:code.str,priceQuote:priceMatch[1],existingOfferId:null,imageIndex:null});
 }
 const codes=rows.filter(item=>/^U\d{8}$/i.test(item.str)).sort((a,b)=>b.y-a.y||a.x-b.x);
 for(const code of codes){
  const sameLine=rows.filter(item=>Math.abs(item.y-code.y)<=0.75).sort((a,b)=>a.x-b.x);
  const nextCode=codes.filter(item=>Math.abs(item.y-code.y)<=0.75&&item.x>code.x).sort((a,b)=>a.x-b.x)[0];
  const columnLeft=code.x<200?0:code.x<380?200:380;
  const columnRight=code.x<200?200:code.x<380?380:620;
  const lineEnd=Math.min(columnRight,nextCode?.x??columnRight);
  const priceItems=sameLine.filter(item=>item.x>code.x&&item.x<lineEnd&&/(?<![\d,])\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)/u.test(item.str));
  if(priceItems.length!==1)continue;
  const priceMatch=/(?<![\d,])(\d{1,3}(?:\.\d{3})*,\d{2})(?!\d)/u.exec(priceItems[0].str);
  if(!priceMatch)continue;
  const dimensionItems=sameLine.filter(item=>item.x>=columnLeft&&item.x<code.x&&item.str!=="•");
  const dimensions=dimensionItems.map(item=>item.str).filter(value=>/[\p{L}\d]/u.test(value));
  if(!dimensions.length)continue;
  const identity=`${code.str}|${code.y}|${priceMatch[1]}`;
  if(seen.has(identity))continue;
  seen.add(identity);
  const name=`${dimensions.join(" ")} (${code.str})`.slice(0,180);
  const evidence=[...dimensions,code.str];
  products.push({name,description:dimensions.join(" — "),price:parsePrice(priceMatch[1]),currency:"EUR",
   nameQuote:JSON.stringify(evidence),descriptionQuote:JSON.stringify(dimensions),priceQuote:priceMatch[1],existingOfferId:null,imageIndex:null});
 }
 return products;
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
