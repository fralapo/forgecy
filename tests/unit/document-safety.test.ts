import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { assertSafeDocument, DocumentSafetyError, inspectDocxArchive } from "../../lib/document-safety";
import { extractDocument } from "../../lib/document-extract";

const MIME="application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const CT='<?xml version="1.0" encoding="UTF-8"?>' +
 '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
 '<Default Extension="xml" ContentType="application/xml"/>' +
 '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
 '</Types>';
const REL='<?xml version="1.0" encoding="UTF-8"?>' +
 '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
 '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
 '</Relationships>';
const XML='<?xml version="1.0" encoding="UTF-8"?>' +
 '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
 '<w:body><w:p><w:r><w:t>Servizi di consulenza grafica e strategia digitale verificati.</w:t></w:r></w:p></w:body></w:document>';
type Entry={name:string;body:string;method?:0|8;flags?:number;declaredSize?:number};
const validEntries:Entry[]=[
  {name:"[Content_Types].xml",body:CT},
  {name:"_rels/.rels",body:REL},
  {name:"word/document.xml",body:XML}
];
function crc32(buffer:Buffer):number{
 let c=0xffffffff;
 for(const b of buffer){
   c^=b;
   for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);
 }
 return (c^0xffffffff)>>>0;
}
function zip(entries:Entry[]):Buffer{
 const locals:Buffer[]=[];
 const directs:Buffer[]=[];
 let index=0;
 for(const e of entries){
   const name=Buffer.from(e.name,"utf8");
   const data=Buffer.from(e.body,"utf8");
   const method=e.method??8;
   const payload=method===8?deflateRawSync(data):data;
   const size=e.declaredSize??data.length;
   const crc=crc32(data);
   const head=Buffer.alloc(30);
   head.writeUInt32LE(0x04034b50,0);
   head.writeUInt16LE(20,4);
   head.writeUInt16LE(e.flags??0x800,6);
   head.writeUInt16LE(method,8);
   head.writeUInt32LE(crc,14);
   head.writeUInt32LE(payload.length,18);
   head.writeUInt32LE(size,22);
   head.writeUInt16LE(name.length,26);
   const record=Buffer.concat([head,name,payload]);
   const dir=Buffer.alloc(46);
   dir.writeUInt32LE(0x02014b50,0);
   dir.writeUInt16LE(20,4);
   dir.writeUInt16LE(20,6);
   dir.writeUInt16LE(e.flags??0x800,8);
   dir.writeUInt16LE(method,10);
   dir.writeUInt32LE(crc,16);
   dir.writeUInt32LE(payload.length,20);
   dir.writeUInt32LE(size,24);
   dir.writeUInt16LE(name.length,28);
   dir.writeUInt32LE(index,42);
   directs.push(Buffer.concat([dir,name]));
   locals.push(record);
   index+=record.length;
 }
 const central=Buffer.concat(directs);
 const eocd=Buffer.alloc(22);
 eocd.writeUInt32LE(0x06054b50,0);
 eocd.writeUInt16LE(entries.length,8);
 eocd.writeUInt16LE(entries.length,10);
 eocd.writeUInt32LE(central.length,12);
 eocd.writeUInt32LE(index,16);
 return Buffer.concat([...locals,central,eocd]);
}
function errorArchive(entries:Entry[],message:RegExp){
 assert.throws(()=>inspectDocxArchive(zip(entries)),message);
}

test("safe DOCX passes strict archive inspection and real Mammoth extraction",async()=>{
 const bytes=zip(validEntries);
 assert.deepEqual(inspectDocxArchive(bytes).entries,3);
 assertSafeDocument(bytes,MIME,"brand.docx");
 const extracted=await extractDocument(bytes,MIME,"brand.docx");
 assert.equal(extracted.status,"ready",extracted.error||"");
 assert.match(extracted.body,/consulenza grafica/);
});
test("unsupported, encrypted, duplicated, path-traversal, macro and active content is blocked",()=>{
 errorArchive([...validEntries,{name:"../private.xml",body:"bad"}],/percorsi/);
 errorArchive([...validEntries,{name:"word/document.xml",body:"duplicate"}],/duplicati/);
 errorArchive(validEntries.map((e,i)=>({...e,flags:i===1?1:0x800})),/cifrato/);
 errorArchive([...validEntries,{name:"word/embeddings/oleObject1.bin",body:"danger"}],/non consentiti/);
 errorArchive([...validEntries,{name:"word/vbaProject.bin",body:"macro"}],/non consentiti/);
 errorArchive(validEntries.map((e,i)=>i===0?{...e,body:e.body.replace("</Types>","<Override ContentType=\"application/vnd.ms-word.document.macroEnabled.main+xml\"/></Types>")}:e),/senza macro/);
});
test("actual expansion and forged ZIP claims are rejected before DOCX parsing",()=>{
 errorArchive([...validEntries,{name:"word/huge.xml",body:"X".repeat(70_000)}],/espande/);
 errorArchive(validEntries.map((e,i)=>i===2?{...e,declaredSize:Buffer.byteLength(XML)+10}:e),/Dimensioni/);
 const archive=zip(validEntries);
 archive.writeUInt32LE(0xffffffff,archive.length-6);
 assert.throws(()=>inspectDocxArchive(archive),DocumentSafetyError);
});
test("PDF and image MIME/signature mismatch cannot be saved as a trusted source",()=>{
 const bad=new TextEncoder().encode("not a PDF%%EOF");
 assert.throws(()=>assertSafeDocument(bad,"application/pdf","report.pdf"),DocumentSafetyError);
 assert.throws(()=>assertSafeDocument(bad,"text/plain","report.pdf"),DocumentSafetyError);
 assert.throws(()=>assertSafeDocument(new Uint8Array([1,2,3,4]),"image/png","fake.png"),DocumentSafetyError);
 assert.throws(()=>assertSafeDocument(new Uint8Array(0),"text/plain","zero.txt"),DocumentSafetyError);
 assert.throws(()=>assertSafeDocument(Buffer.from([0xff,0xfe]),"text/plain","invalid.txt"),DocumentSafetyError);
 assertSafeDocument(Buffer.from("%PDF-1.7\n%%EOF"),"application/pdf","ok.pdf");
});
test("plain text and UTF-8 content remain valid",async()=>{
 const text="Consulenza di brand positioning e UX";
 assertSafeDocument(Buffer.from(text),"text/plain","brief.txt");
 const result=await extractDocument(Buffer.from(text),"text/plain","brief.txt");
 assert.equal(result.status,"ready");
 assert.match(result.body,/brand positioning/);
});
