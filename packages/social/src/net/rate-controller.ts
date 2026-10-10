export interface RateWindow {
  /** A bucket name, or "*" to count every request. */
  bucket: string;
  limit: number;
  windowMs: number;
}

export interface RateControllerConfig {
  windows: RateWindow[];
  jitter: { baseMs: number; maxMs: number };
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface RateWindowSnapshot extends RateWindow {
  count: number;
}

export interface RateController {
  /** Ms until a request in this bucket fits every matching window; 0 when allowed now. */
  waitTime(bucket: string): number;
  record(bucket: string): void;
  acquire(bucket: string): Promise<void>;
  snapshot(): RateWindowSnapshot[];
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function createRateController(cfg: RateControllerConfig): RateController {
  const now = cfg.now ?? Date.now;
  const sleep = cfg.sleep ?? defaultSleep;
  const random = cfg.random ?? Math.random;
  // One ascending list of request times per window.
  const hits = cfg.windows.map((): number[] => []);

  const matches = (w: RateWindow, bucket: string): boolean =>
    w.bucket === "*" || w.bucket === bucket;

  const prune = (i: number, t: number): number[] => {
    const list = hits[i]!;
    const cutoff = t - cfg.windows[i]!.windowMs;
    let drop = 0;
    while (drop < list.length && list[drop]! <= cutoff) drop++;
    if (drop > 0) list.splice(0, drop);
    return list;
  };

  const waitTime = (bucket: string): number => {
    const t = now();
    let wait = 0;
    cfg.windows.forEach((w, i) => {
      if (!matches(w, bucket)) return;
      const list = prune(i, t);
      if (list.length < w.limit) return;
      // The (count - limit)th oldest hit must expire before a new one fits.
      wait = Math.max(wait, list[list.length - w.limit]! + w.windowMs - t);
    });
    return wait;
  };

  const record = (bucket: string): void => {
    const t = now();
    cfg.windows.forEach((w, i) => {
      if (matches(w, bucket)) hits[i]!.push(t);
    });
  };

  return {
    waitTime,
    record,
    async acquire(bucket) {
      // Loop: another caller may have taken the slot while we slept.
      for (let wait = waitTime(bucket); wait > 0; wait = waitTime(bucket)) await sleep(wait);
      // Record before the jitter so concurrent callers see the slot as taken.
      record(bucket);
      const jitter = Math.min(cfg.jitter.maxMs, cfg.jitter.baseMs * -Math.log(1 - random()));
      if (jitter > 0) await sleep(jitter);
    },
    snapshot() {
      const t = now();
      return cfg.windows.map((w, i) => ({ ...w, count: prune(i, t).length }));
    },
  };
}
