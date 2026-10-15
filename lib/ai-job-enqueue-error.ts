export type AiJobEnqueueError = { code?: string; message: string };

export function mapAiJobEnqueueError(error: AiJobEnqueueError) {
  if (error.code === "P0429") {
    if (error.message === "Limite lavori AI raggiunto") {
      return {
        status: 429,
        message: "Hai raggiunto il limite giornaliero di lavori AI per questo cliente. Riprova più tardi."
      } as const;
    }
    return {
      status: 429,
      message: "Hai raggiunto il limite temporaneo di richieste AI per questo cliente o per il workspace. Riprova più tardi."
    } as const;
  }
  return {
    status: 503,
    message: "La coda AI non è disponibile in questo momento. Controlla lo stato locale e riprova."
  } as const;
}
