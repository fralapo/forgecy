export type ProductImageSource = {
 id:string;
 title:string;
 file_path?:string|null;
 source_metadata?:Record<string,unknown>|null;
};

function normalizeProductName(value:string):string{
 return value
  .replace(/&#(\d+);/g,(_,code:string)=>String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi,(_,code:string)=>String.fromCodePoint(parseInt(code,16)))
  .replace(/&(?:apos|#39);/gi,"'")
  .replace(/&amp;/gi,"&")
  .normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .toLocaleLowerCase("it")
  .replace(/[^\p{L}\p{N}]+/gu,"");
}

/** Match an offer to the most specific saved website product image family. */
export function matchWebsiteProductImage(offerName:string,sources:ProductImageSource[]):ProductImageSource|null{
 const offer=normalizeProductName(offerName);
 if(offer.length<12)return null;
 let best:ProductImageSource|null=null;
 let bestLength=0;
 for(const source of sources){
  if(!source.id||!source.file_path||source.source_metadata?.asset_role!=="product")continue;
  const title=normalizeProductName(source.title);
  // A short or generic label is too ambiguous to attach to a product.
  if(title.length<10||!offer.startsWith(title))continue;
  if(title.length>bestLength){best=source;bestLength=title.length;}
 }
 return best;
}
