export type SourceChunkDraft={ordinal:number;body:string;sectionTitle:string};

const MAX_CHARS=1500;
const MIN_BREAK=720;
const OVERLAP=180;

/**
 * Keep source text byte-for-byte recognizable for quote verification while
 * cutting at headings and paragraph boundaries whenever possible.
 */
export function splitSourceIntoChunks(body:string):SourceChunkDraft[]{
 const source=body.replace(/\r\n?/g,"\n");
 const chunks:SourceChunkDraft[]=[];
 let sectionTitle="";
 let offset=0;
 const heading=/^#{1,4}\s+(.+)\s*$/gm;
 let next=heading.exec(source);
 while(offset<source.length&&chunks.length<80){
  while(next&&next.index<offset){sectionTitle=next[1].trim().slice(0,240);next=heading.exec(source);}
  if(next&&next.index===offset){sectionTitle=next[1].trim().slice(0,240);next=heading.exec(source);}
  const sectionEnd=next?.index??source.length;
  let end=Math.min(offset+MAX_CHARS,sectionEnd);
  if(end<sectionEnd){
   const paragraphBreak=source.lastIndexOf("\n\n",end);
   if(paragraphBreak>=offset+MIN_BREAK)end=paragraphBreak;
   else {
    const sentenceBreak=Math.max(source.lastIndexOf(". ",end),source.lastIndexOf("! ",end),source.lastIndexOf("? ",end));
    if(sentenceBreak>=offset+MIN_BREAK)end=sentenceBreak+1;
   }
  }
  const raw=source.slice(offset,end);
  const leading=raw.length-raw.trimStart().length;
  const trailing=raw.trimEnd().length;
  const start=offset+leading;
  const finish=offset+trailing;
  const excerpt=source.slice(start,finish);
  if(excerpt.trim())chunks.push({ordinal:chunks.length,body:excerpt,sectionTitle});
  if(finish>=sectionEnd){offset=sectionEnd;continue;}
  offset=Math.max(start+1,finish-OVERLAP);
  const nextParagraph=source.indexOf("\n\n",offset);
  if(nextParagraph>=0&&nextParagraph<finish+80)offset=nextParagraph+2;
 }
 return chunks;
}
