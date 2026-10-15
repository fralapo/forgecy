export type AiJobEnqueueError = { code?: string; message: string };

export function mapAiJobEnqueueError(_error: AiJobEnqueueError) {
  return {
    status: 503,
    message: "La coda AI non è disponibile in questo momento. Controlla lo stato locale e riprova."
  } as const;
}
