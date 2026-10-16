export type ProductImageSource = {
 id:string;
 title:string;
 file_path?:string|null;
 url?:string|null;
 content_sha256?:string|null;
 source_metadata?:Record<string,unknown>|null;
};

function decodeProductText(value:string):string{
 return value
  .replace(/&#(\d+);/g,(_,code:string)=>String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi,(_,code:string)=>String.fromCodePoint(parseInt(code,16)))
  .replace(/&(?:apos|#39);/gi,"'")
  .replace(/&amp;/gi,"&")
  .normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .toLocaleLowerCase("it")
  .replace(/\bultra\s+power\b/gu,"ultrapower");
}

function productWords(value:string):string[]{
 return decodeProductText(value).match(/[\p{L}\p{N}]+/gu)||[];
}

function normalizeProductName(value:string):string{
 return productWords(value).join("");
}

function imageFilenameTokens(source:ProductImageSource):Set<string>{
 if(!source.url)return new Set();
 let pathname=source.url;
 try{pathname=new URL(source.url,"https://forgecy.local").pathname;}catch{/* use the supplied path */}
 let filename=pathname.split("/").at(-1)||"";
 try{filename=decodeURIComponent(filename);}catch{/* keep the raw filename */}
 filename=filename.replace(/(?:\.(?:webp|png|jpe?g|avif|gif))+$/i,"").replace(/[-_]\d+x\d+$/i,"");
 return new Set(productWords(filename).filter(word=>!/^\d+$/.test(word)&&!/^\d+ml$/i.test(word)&&
  !["dd","webp","png","jpg","jpeg","avif","gif","prof","row","clean"].includes(word)));
}

function variantWinner(source:ProductImageSource,offerNames:string[]):string|null{
 const titleTokens=productWords(source.title);
 if(!titleTokens.length)return null;
 const titleWords=new Set(titleTokens);
 const filenameTokens=imageFilenameTokens(source);
 if(!filenameTokens.size)return null;
 const scores=new Map<string,number>();
 for(const name of offerNames){
  const normalized=normalizeProductName(name),remaining=productWords(name);
  let includesTitle=true;
  for(const word of titleTokens){
   const index=remaining.indexOf(word);
   if(index<0){includesTitle=false;break;}
   remaining.splice(index,1);
  }
  if(!includesTitle||!remaining.length)continue;
  const suffix=remaining;
  const distinct=suffix.filter(word=>word.length>=3&&!titleWords.has(word)&&!(["essenza","profumo","profumi"].includes(word)));
  const score=distinct.filter(word=>filenameTokens.has(word)||[...filenameTokens].some(token=>token.includes(word))).length;
  if(score>0)scores.set(normalized,Math.max(score,scores.get(normalized)||0));
 }
 if(!scores.size)return null;
 const highest=Math.max(...scores.values());
 const winners=[...scores].filter(([,score])=>score===highest).map(([name])=>name);
 return winners.length===1?winners[0]!:null;
}

/** Match a website image only to an exact product or a variant named by the asset filename. */
export function matchWebsiteProductImage(offerName:string,sources:ProductImageSource[],knownOfferNames:string[]=[offerName]):ProductImageSource|null{
 const offerWords=productWords(offerName);
 if(offerWords.join("").length<12)return null;
 const offerKey=[...new Set(offerWords)].sort().join(" ");
 const matches=sources.filter(source=>source.id&&source.file_path&&source.source_metadata?.asset_role==="product")
  .flatMap(source=>{
   const titleWords=productWords(source.title);
   if(titleWords.length<2)return [];
   const titleKey=[...new Set(titleWords)].sort().join(" ");
   const exact=titleKey===offerKey;
   const winner=variantWinner(source,knownOfferNames);
   if(winner&&winner!==normalizeProductName(offerName))return [];
   if(exact)return [{source,score:10_000+titleWords.length}];
   if(!winner||winner!==normalizeProductName(offerName))return [];
   if(!titleWords.every(word=>offerWords.includes(word)))return [];
   return [{source,score:productWords(source.title).length+productWords(offerName).length}];
  });
 if(!matches.length)return null;
 const bestScore=Math.max(...matches.map(item=>item.score));
 const best=matches.filter(item=>item.score===bestScore);
 const uniqueAssets=new Map<string,ProductImageSource>();
 for(const item of best){
  const identity=item.source.content_sha256||item.source.id;
  if(!uniqueAssets.has(identity))uniqueAssets.set(identity,item.source);
 }
 return uniqueAssets.size===1?[...uniqueAssets.values()][0]!:null;
}
