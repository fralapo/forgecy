import { randomUUID } from "node:crypto";
import { AiProviderError } from "../errors";
import {
  addUsage,
  type ImageGenerationJob,
  type ImageGenerationStatus,
  type ImageSize,
  type Usage,
} from "../types";

/** Rethrows `err`, adding what earlier variants of the same request already billed. */
export function failAfterCharge(err: unknown, spent: Usage | undefined): never {
  if (err instanceof AiProviderError && spent)
    err.usage = err.usage ? addUsage(spent, err.usage) : spent;
  throw err;
}

/** Keeps finished jobs of synchronous image providers so getStatus() can answer. Bounded. */
export function createJobStore(max = 100) {
  const jobs = new Map<string, ImageGenerationStatus>();
  return {
    put(job: Omit<ImageGenerationJob, "jobId">): ImageGenerationJob {
      const full = { jobId: randomUUID(), ...job };
      jobs.set(full.jobId, full);
      while (jobs.size > max) {
        const oldest = jobs.keys().next().value;
        if (oldest === undefined) break;
        jobs.delete(oldest);
      }
      return full;
    },
    get(jobId: string): ImageGenerationStatus {
      return jobs.get(jobId) ?? { jobId, state: "failed", error: "unknown job id" };
    },
  };
}

/** Pick the candidate whose aspect ratio is closest to the requested size. */
export function nearestAspect<T extends { ratio: number }>(
  size: ImageSize,
  candidates: readonly T[],
): T {
  const target = size.w / size.h;
  let best = candidates[0]!;
  for (const c of candidates) {
    if (Math.abs(Math.log(c.ratio / target)) < Math.abs(Math.log(best.ratio / target))) best = c;
  }
  return best;
}
