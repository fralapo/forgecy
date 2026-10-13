import {createClient} from "@supabase/supabase-js";
import {ApiFailure} from "./http";

/** Privileged, server-only client. Never import this module into a client component. */
export function workerDb(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new ApiFailure(503,"Worker non configurato: mancano le credenziali Supabase lato server");
  return createClient(url,key,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{headers:{"X-Client-Info":"forgecy-job-worker"}}
  });
}
