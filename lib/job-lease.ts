/**
 * Worker-side fencing for long-running AI jobs. A renewable database lease
 * is an ownership claim, not a cancellation token for provider requests.
 */
export class JobLeaseLost extends Error {
  constructor() {
    super("Il worker ha perso la lease esclusiva del lavoro");
    this.name="JobLeaseLost";
  }
}

/**
 * Ensure a worker owns its current attempt before and after awaited work.
 * The caller can also checkpoint immediately before important database writes.
 * Renewal errors fail CLOSED; the expired attempt is recovered by the next poll.
 */
export async function runWithJobLease<T>(
  renew:()=>Promise<boolean>,
  work:(checkpoint:()=>Promise<void>)=>Promise<T>,
  intervalMs=30_000
):Promise<T>{
  if(!Number.isFinite(intervalMs)||intervalMs<1)throw new Error("Intervallo heartbeat non valido");
  let lost=false;
  let stopped=false;
  let inFlight:Promise<void>|null=null;
  function pulse():Promise<void>{
    if(stopped||lost)return Promise.resolve();
    if(inFlight)return inFlight;
    const request=(async()=>{
      try {
        if(!await renew()) lost=true;
      }catch{
        // An unknown DB state is not permission to keep executing as the owner.
        lost=true;
      }
    })();
    const pending=request.finally(()=>{if(inFlight===pending)inFlight=null;});
    inFlight=pending;
    return pending;
  }
  const checkpoint=async()=>{
    if(lost)throw new JobLeaseLost();
    await pulse();
    if(lost)throw new JobLeaseLost();
  };
  await checkpoint(); // validate ownership before ANY user-data write
  const timer=setInterval(()=>{void pulse();},intervalMs);
  try{
    const result=await work(checkpoint);
    await checkpoint();
    return result;
  }finally{
    clearInterval(timer);
    stopped=true;
    if(inFlight)await inFlight;
  }
}
