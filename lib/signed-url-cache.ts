type Entry={value:string;expiresAt:number};

export function createSignedUrlCache(ttlMs=90_000,now:()=>number=Date.now,capacity=256){
 const entries=new Map<string,Entry>();
 const pending=new Map<string,Promise<string>>();
 return {
  get(key:string,load:()=>Promise<string>):Promise<string>{
   const cached=entries.get(key);
   if(cached&&cached.expiresAt>now()+5_000){
    entries.delete(key);
    entries.set(key,cached);
    return Promise.resolve(cached.value);
   }
   if(cached)entries.delete(key);
   const inFlight=pending.get(key);
   if(inFlight)return inFlight;
   const request=load().then(value=>{
    entries.set(key,{value,expiresAt:now()+ttlMs});
    while(entries.size>capacity){
     const oldest=entries.keys().next().value;
     if(oldest===undefined)break;
     entries.delete(oldest);
    }
    return value;
   }).finally(()=>pending.delete(key));
   pending.set(key,request);
   return request;
  }
 };
}
