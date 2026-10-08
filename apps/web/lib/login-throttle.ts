import { createHash } from "node:crypto";
import { usernameToEmail } from "./username";

/**
 * Per-identity brute-force throttle for password sign-in, on top of Better Auth's per-IP limiter
 * (which cannot stop an attacker who rotates addresses). 5 free failures, then a lock of 30 s that
 * doubles per further failure up to 15 minutes. The failure counter slides, so waiting out a lock
 * never buys a fresh budget. Unknown usernames are counted exactly like known ones (no enumeration).
 * ponytail: a known username can be kept locked by one bad attempt per 15 minutes (availability
 * trade-off, see ADR 0014); the recovery is deleting the `forgecy:login:*` keys in Redis.
 */
export interface ThrottleStore {
  incr(key: string, ttlSeconds: number): Promise<number>;
  lock(key: string, ttlSeconds: number): Promise<void>;
  ttl(key: string): Promise<number>;
  del(...keys: string[]): Promise<void>;
}

export interface ThrottleOptions {
  freeAttempts: number;
  baseLockSeconds: number;
  maxLockSeconds: number;
  windowSeconds: number;
}

const DEFAULTS: ThrottleOptions = {
  freeAttempts: 5,
  baseLockSeconds: 30,
  maxLockSeconds: 900,
  windowSeconds: 900,
};

export function lockSeconds(failures: number, o: ThrottleOptions = DEFAULTS): number {
  if (failures <= o.freeAttempts) return 0;
  return Math.min(o.baseLockSeconds * 2 ** (failures - o.freeAttempts - 1), o.maxLockSeconds);
}

function keysFor(identifier: string) {
  // Same normalisation as the login form (trim + toLowerCase, a superset of the toLowerCase Better Auth
  // applies to look the account up), bounded and hashed so a hostile identifier cannot bloat Redis keys.
  const id = createHash("sha256")
    .update(usernameToEmail(identifier.slice(0, 254)))
    .digest("hex")
    .slice(0, 32);
  return { count: `forgecy:login:fail:${id}`, lock: `forgecy:login:lock:${id}` };
}

export function createLoginThrottle(store: ThrottleStore, options: Partial<ThrottleOptions> = {}) {
  const o = { ...DEFAULTS, ...options };
  return {
    /** Seconds the identity is locked for; 0 means it may try. */
    retryAfter: (identifier: string) => store.ttl(keysFor(identifier).lock),
    /** Records a wrong password and returns the lock now in force (0 = none). */
    async failed(identifier: string): Promise<number> {
      const k = keysFor(identifier);
      const seconds = lockSeconds(await store.incr(k.count, o.windowSeconds), o);
      if (seconds > 0) await store.lock(k.lock, seconds);
      return seconds;
    },
    async succeeded(identifier: string): Promise<void> {
      const k = keysFor(identifier);
      await store.del(k.count, k.lock);
    },
  };
}

/** The subset of ioredis used here (the web app already holds one for BullMQ). */
export type RedisLike = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
};

export function redisThrottleStore(redis: RedisLike): ThrottleStore {
  return {
    async incr(key, ttlSeconds) {
      const n = await redis.incr(key);
      await redis.expire(key, ttlSeconds);
      return n;
    },
    async lock(key, ttlSeconds) {
      await redis.set(key, "1", "EX", ttlSeconds);
    },
    async ttl(key) {
      return Math.max(0, await redis.ttl(key)); // -2 no key, -1 no expiry: both mean "not locked"
    },
    async del(...keys) {
      await redis.del(...keys);
    },
  };
}
