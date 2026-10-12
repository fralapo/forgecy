import "server-only";
import { createLoginThrottle, type RedisLike, redisThrottleStore } from "./login-throttle";
import { getQueues } from "./queues";

let throttle: ReturnType<typeof createLoginThrottle> | undefined;
async function get() {
  if (!throttle) {
    const queues = await getQueues();
    throttle = createLoginThrottle(redisThrottleStore(queues.connection as unknown as RedisLike));
  }
  return throttle;
}

/** Fail open: if Redis is unreachable the per-IP limiter still applies, and sign-in is not taken down with it. */
async function open<T>(
  fallback: T,
  run: (t: ReturnType<typeof createLoginThrottle>) => Promise<T>,
): Promise<T> {
  try {
    return await run(await get());
  } catch {
    console.warn("Login throttle unavailable (Redis); relying on the per-IP limiter.");
    return fallback;
  }
}

export const loginGuard = {
  attempt: (id: string) => open(0, (t) => t.attempt(id)),
  refund: (id: string) => open(undefined, (t) => t.refund(id)),
  succeeded: (id: string) => open(undefined, (t) => t.succeeded(id)),
};
