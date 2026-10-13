import {timingSafeEqual} from "node:crypto";
import {json,fail,ApiFailure} from "@/lib/http";
import {processNextJob} from "@/lib/job-runner";
export const runtime="nodejs";
export const maxDuration=240;
export async function GET(request:Request){
 try{
  const secret=process.env.CRON_SECRET;
  if(!secret||secret.length<24)throw new ApiFailure(503,"Worker disabilitato: configura CRON_SECRET (almeno 24 caratteri)");
  const provided=request.headers.get("authorization")||"";
  const expected=Buffer.from("Bearer "+secret);
  const received=Buffer.from(provided);
  if(received.length!==expected.length||!timingSafeEqual(received,expected))
   throw new ApiFailure(401,"Worker non autorizzato");
  return json(await processNextJob());
 }catch(e){return fail(e);}
}
