import { createHash } from "node:crypto";
import { usernameToEmail } from "./username";

/**
 * Per-identity brute-force throttle for password sign-in, on top of Better Auth's per-IP limiter
 * (which cannot stop an attacker who rotates addresses).
 *
 * Every attempt takes an atomic ticket BEFORE the password is checked, so a burst of concurrent
 * requests cannot all slip past a lock that has not been set yet. 5 attempts are free; the 5th sets
 * a lock of 30 s, after which exactly one more attempt is granted (and it sets a lock twice as long,
 * up to 15 minutes). Requests refused during a lock take no ticket, so retrying does not escalate it.
 * The ticket counter slides over an hour, longer than the longest lock, so waiting out a lock buys
 * one attempt, never a fresh budget; only an hour without any attempt resets it. A successful
 * sign-in clears everything. Unknown usernames are counted exactly like known ones (no enumeration).
 * ponytail: a known username can be kept locked by one attempt per lock period (availability
 * trade-off, see ADR 0014); the recovery is deleting the `forgecy:login:*` keys in Redis.
 */
export interface ThrottleStore {
  /** +1 and (re)set the TTL in one atomic step; returns the new count. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  /** -1, keeping the TTL (a bare DECR on a vanished key would create one without any). */
  decr(key: string, ttlSeconds: number): Promise<void>;
  /** Sets the key for `ttlSeconds` only if it is free; true when this call took it. */
  acquire(key: string, ttlSeconds: number): Promise<boolean>;
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
  windowSeconds: 3600, // must stay above maxLockSeconds, or waiting at the cap would reset the count
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
  const retryAfter = (identifier: string) => store.ttl(keysFor(identifier).lock);
  return {
    /** Seconds the identity is locked for; 0 means it may try. Read-only. */
    retryAfter,
    /**
     * Takes a ticket for one password check. Returns 0 when the attempt may go ahead, otherwise the
     * seconds to wait (the caller must then not check the password).
     */
    async attempt(identifier: string): Promise<number> {
      const k = keysFor(identifier);
      const waiting = await store.ttl(k.lock);
      if (waiting > 0) return waiting;
      const n = await store.incr(k.count, o.windowSeconds);
      const next = lockSeconds(n + 1, o); // the lock that follows this attempt
      if (next === 0) return 0;
      // One winner per lock period, even when many requests arrive together.
      if (await store.acquire(k.lock, next)) return 0;
      return Math.max(1, await store.ttl(k.lock));
    },
    /** Gives the ticket back when the attempt failed before any password was checked (e.g. a bad body). */
    async refund(identifier: string): Promise<void> {
      await store.decr(keysFor(identifier).count, o.windowSeconds);
    },
    async succeeded(identifier: string): Promise<void> {
      const k = keysFor(identifier);
      await store.del(k.count, k.lock);
    },
  };
}

/** The subset of ioredis used here (the web app already holds one for BullMQ). */
export type RedisLike = {
  multi(): {
    incr(key: string): unknown;
    decr(key: string): unknown;
    expire(key: string, seconds: number): unknown;
    exec(): Promise<[Error | null, unknown][] | null>;
  };
  set(key: string, value: string, mode: "EX", seconds: number, nx: "NX"): Promise<unknown>;
  ttl(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
};

export function redisThrottleStore(redis: RedisLike): ThrottleStore {
  return {
    async incr(key, ttlSeconds) {
      // INCR and EXPIRE in one transaction: a dropped connection cannot leave a counter without a TTL.
      const tx = redis.multi();
      tx.incr(key);
      tx.expire(key, ttlSeconds);
      const results = await tx.exec();
      const [err, n] = results?.[0] ?? [new Error("Redis transaction failed")];
      if (err || typeof n !== "number") throw err ?? new Error("Redis transaction failed");
      return n;
    },
    async decr(key, ttlSeconds) {
      const tx = redis.multi();
      tx.decr(key);
      tx.expire(key, ttlSeconds);
      await tx.exec();
    },
    async acquire(key, ttlSeconds) {
      return (await redis.set(key, "1", "EX", ttlSeconds, "NX")) === "OK";
    },
    async ttl(key) {
      return Math.max(0, await redis.ttl(key)); // -2 no key, -1 no expiry: both mean "not locked"
    },
    async del(...keys) {
      await redis.del(...keys);
    },
  };
}
