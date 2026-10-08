import { describe, expect, it } from "vitest";
import { createLoginThrottle, lockSeconds, type RedisLike, redisThrottleStore, type ThrottleStore } from "./login-throttle";

function memoryStore(clock: { now: number }): ThrottleStore {
  const counters = new Map<string, { n: number; exp: number }>();
  const locks = new Map<string, number>();
  const live = (exp: number) => exp > clock.now;
  return {
    async incr(key, ttl) {
      const cur = counters.get(key);
      const n = cur && live(cur.exp) ? cur.n + 1 : 1;
      counters.set(key, { n, exp: clock.now + ttl * 1000 });
      return n;
    },
    async decr(key) {
      const cur = counters.get(key);
      if (cur && live(cur.exp)) cur.n = Math.max(0, cur.n - 1);
    },
    async acquire(key, ttl) {
      const exp = locks.get(key);
      if (exp && live(exp)) return false;
      locks.set(key, clock.now + ttl * 1000);
      return true;
    },
    async ttl(key) {
      const exp = locks.get(key);
      return exp && live(exp) ? Math.ceil((exp - clock.now) / 1000) : 0;
    },
    async del(...keys) {
      for (const k of keys) {
        counters.delete(k);
        locks.delete(k);
      }
    },
  };
}

function setup() {
  const clock = { now: 1_000_000 };
  return { clock, throttle: createLoginThrottle(memoryStore(clock)) };
}

describe("lockSeconds", () => {
  it("is free for 5 failures, then doubles from 30 s up to 15 minutes", () => {
    expect([1, 5].map((n) => lockSeconds(n))).toEqual([0, 0]);
    expect([6, 7, 8, 9, 10, 11, 50].map((n) => lockSeconds(n))).toEqual([30, 60, 120, 240, 480, 900, 900]);
    expect(lockSeconds(10_000)).toBe(900);
  });
});

describe("createLoginThrottle", () => {
  it("allows 5 attempts, then refuses, whether or not the user exists", async () => {
    const { throttle } = setup();
    for (let i = 0; i < 5; i++) expect(await throttle.attempt("no-such-user")).toBe(0);
    expect(await throttle.attempt("no-such-user")).toBe(30);
    expect(await throttle.retryAfter("no-such-user")).toBe(30);
  });

  it("lets exactly 5 of N concurrent attempts through, however many arrive together", async () => {
    const { throttle } = setup();
    const results = await Promise.all(Array.from({ length: 50 }, () => throttle.attempt("admin")));
    expect(results.filter((s) => s === 0)).toHaveLength(5);
    expect(results.filter((s) => s > 0)).toHaveLength(45);
    expect(await throttle.attempt("admin")).toBeGreaterThan(0);
  });

  it("does not escalate the lock while a request is refused during it", async () => {
    const { clock, throttle } = setup();
    for (let i = 0; i < 5; i++) await throttle.attempt("admin");
    for (let i = 0; i < 20; i++) expect(await throttle.attempt("admin")).toBe(30);
    clock.now += 31_000;
    expect(await throttle.attempt("admin")).toBe(0); // the one attempt granted after the lock
    expect(await throttle.attempt("admin")).toBe(60);
  });

  it("grants one attempt per lock, each lock twice as long, never a fresh budget", async () => {
    const { clock, throttle } = setup();
    for (let i = 0; i < 5; i++) await throttle.attempt("admin");
    const granted: number[] = [];
    for (const wait of [31, 61, 121, 241, 481, 901, 901]) {
      clock.now += wait * 1000;
      granted.push(await throttle.attempt("admin"));
      granted.push(await throttle.retryAfter("admin"));
    }
    expect(granted).toEqual([0, 60, 0, 120, 0, 240, 0, 480, 0, 900, 0, 900, 0, 900]);
  });

  it("still locks for the full 15 minutes after waiting out a 15 minute lock", async () => {
    const { clock, throttle } = setup();
    for (let i = 0; i < 5; i++) await throttle.attempt("admin");
    for (const wait of [31, 61, 121, 241, 481]) {
      clock.now += wait * 1000;
      await throttle.attempt("admin");
    }
    expect(await throttle.retryAfter("admin")).toBe(900);
    clock.now += 901_000;
    expect(await throttle.retryAfter("admin")).toBe(0);
    expect(await throttle.attempt("admin")).toBe(0); // the single attempt after the lock...
    expect(await throttle.attempt("admin")).toBe(900); // ...and it is not a fresh budget of 5
  });

  it("forgets attempts after an hour of quiet", async () => {
    const { clock, throttle } = setup();
    for (let i = 0; i < 5; i++) await throttle.attempt("admin");
    clock.now += 3600 * 1000 + 1000;
    for (let i = 0; i < 5; i++) expect(await throttle.attempt("admin")).toBe(0);
  });

  it("clears everything on a successful sign-in", async () => {
    const { throttle } = setup();
    for (let i = 0; i < 6; i++) await throttle.attempt("admin");
    await throttle.succeeded("admin");
    expect(await throttle.retryAfter("admin")).toBe(0);
    for (let i = 0; i < 5; i++) expect(await throttle.attempt("admin")).toBe(0);
  });

  it("gives a ticket back for an attempt that never reached the password check", async () => {
    const { throttle } = setup();
    for (let i = 0; i < 5; i++) {
      expect(await throttle.attempt("admin")).toBe(0);
      await throttle.refund("admin");
    }
    for (let i = 0; i < 5; i++) expect(await throttle.attempt("admin")).toBe(0);
    expect(await throttle.attempt("admin")).toBe(30);
  });

  it("treats Admin, admin and admin@forgecy.local as one identity but isolates other people", async () => {
    const { throttle } = setup();
    for (const id of ["Admin", " admin ", "admin@forgecy.local", "ADMIN", "admin"]) await throttle.attempt(id);
    expect(await throttle.retryAfter("admin")).toBe(30);
    expect(await throttle.retryAfter("mario")).toBe(0);
  });

  it("applies one lock to every spelling Better Auth resolves to the same account", async () => {
    // Better Auth looks the account up by email.toLowerCase(); the key must collapse at least that much.
    const kelvin = `${String.fromCodePoint(0x212a)}ate`; // lowercases to "kate"
    const { throttle } = setup();
    for (const id of [kelvin, "Kate", "kate", "KATE@Forgecy.Local", `${String.fromCharCode(9)}kate `]) await throttle.attempt(id);
    expect(await throttle.retryAfter("kate")).toBe(30);
    expect(await throttle.retryAfter(kelvin)).toBe(30);
  });

  it("bounds hostile identifiers without throwing", async () => {
    const { throttle } = setup();
    expect(await throttle.attempt("a".repeat(100_000))).toBe(0);
  });
});

describe("redisThrottleStore", () => {
  it("maps INCR+EXPIRE and DECR+EXPIRE in one MULTI each, SET NX EX, TTL (negative means none) and DEL", async () => {
    const calls: unknown[][] = [];
    const redis: RedisLike = {
      multi() {
        const queued: unknown[][] = [];
        const chain = {
          incr: (k: string) => (queued.push(["incr", k]), chain),
          decr: (k: string) => (queued.push(["decr", k]), chain),
          expire: (k: string, s: number) => (queued.push(["expire", k, s]), chain),
          exec: async () => (calls.push(["multi", ...queued]), [[null, 3], [null, 1]] as [Error | null, unknown][]),
        };
        return chain;
      },
      set: async (k, v, m, s, nx) => (calls.push(["set", k, v, m, s, nx]), k === "taken" ? null : "OK"),
      ttl: async (k) => (k === "gone" ? -2 : k === "forever" ? -1 : 42),
      del: async (...k) => (calls.push(["del", ...k]), k.length),
    };
    const store = redisThrottleStore(redis);
    expect(await store.incr("c", 900)).toBe(3);
    await store.decr("c", 900);
    expect(await store.acquire("l", 30)).toBe(true);
    expect(await store.acquire("taken", 30)).toBe(false);
    expect(await store.ttl("l")).toBe(42);
    expect(await store.ttl("gone")).toBe(0);
    expect(await store.ttl("forever")).toBe(0);
    await store.del("a", "b");
    expect(calls).toEqual([
      ["multi", ["incr", "c"], ["expire", "c", 900]],
      ["multi", ["decr", "c"], ["expire", "c", 900]],
      ["set", "l", "1", "EX", 30, "NX"],
      ["set", "taken", "1", "EX", 30, "NX"],
      ["del", "a", "b"],
    ]);
  });

  it("throws when the transaction fails, so the guard can fail open", async () => {
    const chain = { incr: () => chain, decr: () => chain, expire: () => chain, exec: async () => null };
    const store = redisThrottleStore({ multi: () => chain } as unknown as RedisLike);
    await expect(store.incr("c", 1)).rejects.toThrow();
  });
});
