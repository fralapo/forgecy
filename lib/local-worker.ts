declare global {
  var __forgecyLocalWorkerStarted: boolean | undefined;
  var __forgecyLocalWorkerState: { busy: boolean; paused: boolean } | undefined;
}

export async function startLocalWorker() {
  if (globalThis.__forgecyLocalWorkerStarted) return;
  globalThis.__forgecyLocalWorkerStarted = true;
  const state: { busy: boolean; paused: boolean } = globalThis.__forgecyLocalWorkerState = { busy: false, paused: false };
  const { processNextJob } = await import("./job-runner");
  let nextSemanticIndexAt=Date.now()+30_000;
  const tick = async () => {
    if (state.busy || state.paused) return;
    state.busy = true;
    try {
      await processNextJob();
      if(Date.now()>=nextSemanticIndexAt){
        nextSemanticIndexAt=Date.now()+15_000;
        const {localDb,LOCAL_OWNER_ID}=await import("./local-db");
        const preference=localDb().connection.prepare("SELECT semantic_enabled FROM ai_preferences WHERE owner_id=?").get(LOCAL_OWNER_ID) as {semantic_enabled?:number}|undefined;
        if(preference?.semantic_enabled!==0){
          const {indexNextKnowledgeBatch,knowledgeEmbeddingCounts}=await import("./knowledge-index");
          const counts=knowledgeEmbeddingCounts();
          if(counts.indexed<counts.total)await indexNextKnowledgeBatch(null,24);
        }
      }
    }
    catch (error) { console.error("[local worker]", error instanceof Error ? error.message : "Errore durante il lavoro"); }
    finally { state.busy = false; }
  };
  await tick();
  const timer = setInterval(() => void tick(), 1200);
  timer.unref?.();
}

/** Stop claiming new jobs and wait for the active job before replacing SQLite. */
export async function withLocalWorkerPaused<T>(work: () => Promise<T>): Promise<T> {
  const state = globalThis.__forgecyLocalWorkerState;
  if (!state) return work();
  state.paused = true;
  try {
    const deadline = Date.now() + 5 * 60_000;
    while (state.busy) {
      if (Date.now() >= deadline) throw new Error("Un'attività AI è ancora in corso; riprova il ripristino quando è terminata.");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return await work();
  }
  finally { state.paused = false; }
}
