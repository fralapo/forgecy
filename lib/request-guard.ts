/**
 * Origin verification for local workspace API writes.
 * Browsers cannot forge Origin or Sec-Fetch-Site; an external API client must set
 * an approved Origin explicitly. Loopback binding and the Host guard provide the
 * workspace boundary; this check blocks cross-origin browser mutations.
 */
export type MutationRequest = Pick<Request,"method"|"url"|"headers">;
export type GuardResult = {ok:true}|{ok:false;status:403|503;error:string};

const safeMethods=new Set(["GET","HEAD","OPTIONS"]);

function strictOrigin(value:string):string|null{
  try{
    const url=new URL(value);
    if(!["https:","http:"].includes(url.protocol) ||
       url.username || url.password || url.pathname!=="/" ||
       url.search || url.hash || url.origin==="null" ||
       value!==url.origin)return null;
    return url.origin;
  }catch{return null;}
}

function equivalentLoopbackOrigins(left:string,right:string):boolean{
  try{
    const a=new URL(left);
    const b=new URL(right);
    const loopbacks=new Set(["localhost","127.0.0.1","[::1]"]);
    return a.protocol===b.protocol && a.port===b.port &&
      loopbacks.has(a.hostname) && loopbacks.has(b.hostname);
  }catch{return false;}
}

export function guardApiMutation(
 request:MutationRequest,
 options:{appOrigin?:string;production?:boolean}={}
):GuardResult{
  const method=request.method.toUpperCase();
  if(safeMethods.has(method))return {ok:true};
  let destination:URL;
  try{destination=new URL(request.url);}
  catch{return {ok:false,status:403,error:"URL richiesta non valida"};}
  // Only API mutations: OAuth callbacks and cron GETs are unaffected.
  if(!destination.pathname.startsWith("/api/"))return {ok:true};

  const configured=options.appOrigin?.trim();
  // This app only permits loopback or the explicitly configured Tailscale
  // host at the proxy boundary. On loopback, the request URL is therefore a
  // safe default for installations using a nonstandard port. Tailscale uses
  // its separately validated HTTPS origin before reaching this guard.
  const expected=strictOrigin(configured||destination.origin);
  if(!expected)
    return {ok:false,status:503,error:"Origine applicazione configurata in modo non valido"};
  if(options.production && expected.startsWith("http://") &&
     !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(expected))
    return {ok:false,status:503,error:"L'origine dell'applicazione deve usare HTTPS"};

  const from=request.headers.get("origin")||"";
  const requestOrigin=strictOrigin(from);
  if(!requestOrigin ||
     (requestOrigin!==expected && !equivalentLoopbackOrigins(requestOrigin,expected)))
    return {ok:false,status:403,error:"Origine della richiesta non autorizzata"};
  const fetchSite=request.headers.get("sec-fetch-site");
  if(fetchSite && fetchSite!=="same-origin" && fetchSite!=="none")
    return {ok:false,status:403,error:"Richiesta proveniente da un sito esterno"};
  return {ok:true};
}
