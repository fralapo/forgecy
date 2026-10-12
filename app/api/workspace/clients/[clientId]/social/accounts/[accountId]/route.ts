import {z} from "zod";
import {auth,requireClient,json,fail,ApiFailure,dbError,audit} from "@/lib/http";
export const runtime="nodejs";
type Params={params:Promise<{clientId:string;accountId:string}>};
export async function DELETE(_request:Request,{params}:Params){
 try{
  const {clientId,accountId}=await params,ctx=await auth();
  await requireClient(ctx,clientId);
  if(!z.uuid().safeParse(accountId).success)
    throw new ApiFailure(400,"ID account Instagram non valido");
  // Removing a client's account also removes linked snapshots via FK CASCADE.
  // This removes the encrypted token locally; it does not remotely revoke Meta consent.
  const {data,error}=await ctx.db.from("social_accounts").delete()
    .eq("id",accountId).eq("client_id",clientId).eq("platform","instagram")
    .select("id").maybeSingle();
  dbError(error,"Impossibile scollegare l'account");
  if(!data)throw new ApiFailure(404,"Account non trovato nel cliente selezionato");
  await audit(ctx,clientId,"instagram_disconnected",accountId,{
    effect:"local_token_and_snapshots_deleted",remote_oauth_revocation:false
  });
  return json({
    disconnected:true,
    message:"Account e statistiche locali rimossi. Per revocare il consenso remoto, gestisci l'accesso nelle impostazioni Meta."
  });
 }catch(e){return fail(e);}
}
