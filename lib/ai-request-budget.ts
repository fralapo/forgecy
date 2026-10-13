import type {Context} from "./http";
import {ApiFailure} from "./http";

export const AI_REQUEST_KINDS=[
  "chat","adapt","dossier","strategy","mission","image"
] as const;
export type AiRequestKind=(typeof AI_REQUEST_KINDS)[number];

/**
 * Protect the API BEFORE any expensive provider call, even when running on
 * several app instances. PostgreSQL owns the atomic per-client/owner counters.
 *
 * Reservations represent attempts, not currency costs, and are intentionally
 * not refunded on provider failure (to prevent repeated failed-request abuse).
 */
export async function reserveAiRequest(
  ctx:Context,clientId:string,kind:AiRequestKind
):Promise<string>{
  if(!(AI_REQUEST_KINDS as readonly string[]).includes(kind))
    throw new ApiFailure(400,"Operazione AI non consentita");
  const {data,error}=await ctx.db.rpc("forgecy_reserve_ai_request",{
    p_client_id:clientId,p_kind:kind
  });
  if(error?.code==="P0429"){
    throw new ApiFailure(429,
      "Limite temporaneo delle richieste AI raggiunto per questo cliente o per il workspace. Riprova più tardi.");
  }
  if(error){
    console.error("[ai-budget] Impossibile riservare la richiesta",error.code);
    throw new ApiFailure(503,"Protezione delle richieste AI temporaneamente non disponibile.");
  }
  if(typeof data!=="string"||!data){
    throw new ApiFailure(503,"Impossibile confermare la prenotazione della richiesta AI.");
  }
  return data;
}
