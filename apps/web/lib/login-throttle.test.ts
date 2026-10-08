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
    async lock(key, ttl) {
      locks.set(key, clock.now + ttl * 1000);
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
  it("allows 5 wrong passwords, locks on the 6th, whether or not the user exists", async () => {
    const { throttle } = setup();
    for (let i = 0; i < 5; i++) {
      expect(await throttle.failed("no-such-user")).toBe(0);
      expect(await throttle.retryAfter("no-such-user")).toBe(0);
    }
    expect(await throttle.failed("no-such-user")).toBe(30);
    expect(await throttle.retryAfter("no-such-user")).toBe(30);
  });

  it("keeps the count after the lock expires, so the next failure locks twice as long", async () => {
    const { clock, throttle } = setup();
    for (let i = 0; i < 6; i++) await throttle.failed("admin");
    clock.now += 31_000;
    expect(await throttle.retryAfter("admin")).toBe(0);
    expect(await throttle.failed("admin")).toBe(60);
    clock.now += 61_000;
    expect(await throttle.failed("admin")).toBe(120);
  });

  it("forgets failures after 15 quiet minutes", async () => {
    const { clock, throttle } = setup();
    for (let i = 0; i < 5; i++) await throttle.failed("admin");
    clock.now += 15 * 60_000 + 1000;
    expect(await throttle.failed("admin")).toBe(0);
  });

  it("clears everything on a successful sign-in", async () => {
    const { throttle } = setup();
    for (let i = 0; i < 6; i++) await throttle.failed("admin");
    await throttle.succeeded("admin");
    expect(await throttle.retryAfter("admin")).toBe(0);
    for (let i = 0; i < 5; i++) expect(await throttle.failed("admin")).toBe(0);
  });

  it("treats Admin, admin and admin@forgecy.local as one identity but isolates other people", async () => {
    const { throttle } = setup();
    for (const id of ["Admin", " admin ", "admin@forgecy.local", "ADMIN", "admin", "Admin"]) await throttle.failed(id);
    expect(await throttle.retryAfter("admin")).toBe(30);
    expect(await throttle.retryAfter("mario")).toBe(0);
  });

  it("applies one lock to every spelling Better Auth resolves to the same account", async () => {
    // Better Auth looks the account up by email.toLowerCase(); the key must collapse at least that much.
    const { throttle } = setup();
    for (const id of ["\u212Aate", "Kate", "kate", "KATE@Forgecy.Local", "\tkate\n", "KaTe"]) await throttle.failed(id);
    expect(await throttle.retryAfter("kate")).toBe(30);
    expect(await throttle.retryAfter("Kate")).toBe(30);
  });

  it("bounds hostile identifiers without throwing", async () => {
    const { throttle } = setup();
    expect(await throttle.failed("a".repeat(100_000))).toBe(0);
  });
});

describe("redisThrottleStore", () => {
  it("maps INCR+EXPIRE, SET EX, TTL (negative means none) and DEL", async () => {
    const calls: unknown[][] = [];
    const redis: RedisLike = {
      incr: async (k) => (calls.push(["incr", k]), 3),
      expire: async (k, s) => (calls.push(["expire", k, s]), 1),
      set: async (k, v, m, s) => (calls.push(["set", k, v, m, s]), "OK"),
      ttl: async (k) => (k === "gone" ? -2 : k === "forever" ? -1 : 42),
      del: async (...k) => (calls.push(["del", ...k]), k.length),
    };
    const store = redisThrottleStore(redis);
    expect(await store.incr("c", 900)).toBe(3);
    await store.lock("l", 30);
    expect(await store.ttl("l")).toBe(42);
    expect(await store.ttl("gone")).toBe(0);
    expect(await store.ttl("forever")).toBe(0);
    await store.del("a", "b");
    expect(calls).toEqual([["incr", "c"], ["expire", "c", 900], ["set", "l", "1", "EX", 30], ["del", "a", "b"]]);
  });
});
