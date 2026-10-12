import { createCipheriv,createDecipheriv,randomBytes } from "node:crypto";
import { ApiFailure } from "./http";
function key(){
 const raw=process.env.TOKEN_ENCRYPTION_KEY_BASE64;
 if(!raw)throw new ApiFailure(503,"Crittografia Meta non configurata");
 const bytes=Buffer.from(raw,"base64");
 if(bytes.length!==32)throw new ApiFailure(503,"La chiave Meta deve essere di 32 byte in base64");
 return bytes;
}
export function encrypt(text:string){
 const iv=randomBytes(12);
 const cipher=createCipheriv("aes-256-gcm",key(),iv);
 const value=Buffer.concat([cipher.update(text,"utf8"),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),value]).toString("base64");
}
export function decrypt(payload:string){
 const data=Buffer.from(payload,"base64");
 if(data.length<29)throw new ApiFailure(400,"Token non valido");
 const cipher=createDecipheriv("aes-256-gcm",key(),data.subarray(0,12));
 cipher.setAuthTag(data.subarray(12,28));
 return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString("utf8");
}
