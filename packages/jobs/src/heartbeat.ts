/**
 * Call `beat` every `intervalMs` until the returned `stop()` runs. A failing beat is
 * reported, never thrown: the next one retries, and the job itself keeps going.
 */
export function startHeartbeat(
  beat: () => Promise<void>,
  intervalMs: number,
  onError?: (err: unknown) => void,
): () => void {
  const timer = setInterval(() => {
    beat().catch((err) => onError?.(err));
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
