import { describe, expect, it } from "vitest";
import { createCircuitBreaker } from "../src/net/breaker";
import { createGuard } from "../src/net/guard";
import type { GuardEvent } from "../src/net/guard";
import { createRateController } from "../src/net/rate-controller";
import { SourceError } from "../src/types";

/** Sleeping advances the clock, so waits are instant and observable. */
function fakeClock(start = 1_000_000) {
  const c = {
    t: start,
    sleeps: [] as number[],
    now: () => c.t,
    sleep: async (ms: number) => {
      c.sleeps.push(ms);
      c.t += ms;
    },
  };
  return c;
}

describe("rate controller", () => {
  const windows = [
    { bucket: "*", limit: 3, windowMs: 10_000 },
    { bucket: "feed", limit: 1, windowMs: 4_000 },
  ];
  const make = (clock = fakeClock()) => ({
    clock,
    rate: createRateController({
      windows,
      jitter: { baseMs: 100, maxMs: 300 },
      now: clock.now,
      sleep: clock.sleep,
      random: () => 0,
    }),
  });

  it("is open when nothing was recorded", () => {
    expect(make().rate.waitTime("feed")).toBe(0);
  });

  it("applies the bucket window and the wildcard window together", () => {
    const { clock, rate } = make();
    rate.record("feed");
    expect(rate.waitTime("feed")).toBe(4_000);
    expect(rate.waitTime("other")).toBe(0);
    clock.t += 1_000;
    expect(rate.waitTime("feed")).toBe(3_000);

    rate.record("other");
    rate.record("other");
    // "*" is now full (3 hits at t0, t0+1000, t0+1000): next slot opens when the oldest expires.
    expect(rate.waitTime("other")).toBe(9_000);
    clock.t += 3_000; // t0+4000: feed window is free, "*" is not
    expect(rate.waitTime("feed")).toBe(6_000);
    clock.t += 6_000; // t0+10000
    expect(rate.waitTime("feed")).toBe(0);
    expect(rate.waitTime("other")).toBe(0); // the t0 hit expired, two remain
    rate.record("other");
    expect(rate.waitTime("other")).toBe(1_000); // the t0+1000 hits expire at t0+11000
  });

  it("takes the longest wait when several windows are full", () => {
    const { clock, rate } = make();
    rate.record("feed");
    clock.t += 500;
    rate.record("x");
    rate.record("x"); // "*" full
    // feed needs 3500 more, "*" needs 9500 more.
    expect(rate.waitTime("feed")).toBe(9_500);
  });

  it("acquire sleeps until allowed, adds jitter, then records", async () => {
    const { clock, rate } = make();
    rate.record("feed");
    await rate.acquire("feed");
    expect(clock.sleeps).toEqual([4_000]); // random 0 => no jitter sleep
    expect(rate.snapshot().find((w) => w.bucket === "feed")?.count).toBe(1);
    expect(rate.waitTime("feed")).toBe(4_000);
  });

  it("jitter is exponential with mean baseMs and capped at maxMs", async () => {
    const clock = fakeClock();
    const draws = [1 - Math.exp(-1), 0.999999];
    const rate = createRateController({
      windows: [],
      jitter: { baseMs: 100, maxMs: 300 },
      now: clock.now,
      sleep: clock.sleep,
      random: () => draws.shift() ?? 0,
    });
    await rate.acquire("a");
    await rate.acquire("a");
    expect(clock.sleeps[0]).toBeCloseTo(100, 6);
    expect(clock.sleeps[1]).toBe(300);
  });

  it("snapshot reports counts inside the window only", () => {
    const { clock, rate } = make();
    rate.record("feed");
    clock.t += 5_000;
    rate.record("other");
    const snap = rate.snapshot();
    expect(snap.find((w) => w.bucket === "*")?.count).toBe(2);
    expect(snap.find((w) => w.bucket === "feed")?.count).toBe(0);
  });
});

describe("circuit breaker", () => {
  const make = () => {
    const clock = fakeClock();
    return {
      clock,
      b: createCircuitBreaker({ failureThreshold: 3, openMs: 60_000, now: clock.now }),
    };
  };

  it("opens after consecutive transport failures only", () => {
    const { b } = make();
    b.onFailure("transport");
    b.onFailure("transport");
    b.onSuccess();
    expect(b.state().consecutiveFailures).toBe(0);
    b.onFailure("transport");
    b.onFailure("transport");
    expect(b.canRun()).toBe(true);
    b.onFailure("transport");
    expect(b.state()).toMatchObject({ status: "open", reason: "transport" });
    expect(b.canRun()).toBe(false);
  });

  it("ignores failures that say nothing about the connection", () => {
    const { b } = make();
    for (const f of ["not_found", "private", "rate_limited", "disabled"] as const) {
      for (let i = 0; i < 5; i++) b.onFailure(f);
    }
    for (let i = 0; i < 4; i++) b.onFailure("api_drift");
    expect(b.canRun()).toBe(true);
    expect(b.state()).toMatchObject({ status: "closed", consecutiveFailures: 0, driftCount: 4 });
  });

  it("allows one half-open trial after openMs; success closes", () => {
    const { clock, b } = make();
    for (let i = 0; i < 3; i++) b.onFailure("transport");
    clock.t += 59_999;
    expect(b.canRun()).toBe(false);
    clock.t += 1;
    expect(b.canRun()).toBe(true);
    expect(b.state().status).toBe("half-open");
    expect(b.canRun()).toBe(false); // only one trial
    b.onSuccess();
    expect(b.state()).toMatchObject({ status: "closed", reason: null, consecutiveFailures: 0 });
    expect(b.canRun()).toBe(true);
  });

  it("re-opens when the half-open trial fails", () => {
    const { clock, b } = make();
    for (let i = 0; i < 3; i++) b.onFailure("transport");
    clock.t += 60_000;
    expect(b.canRun()).toBe(true);
    b.onFailure("transport");
    expect(b.state()).toMatchObject({ status: "open", openedAt: clock.t });
    clock.t += 59_000;
    expect(b.canRun()).toBe(false);
  });

  it("blocked opens at once and never closes by time", () => {
    const { clock, b } = make();
    b.onFailure("blocked");
    expect(b.state()).toMatchObject({ status: "open", reason: "blocked" });
    clock.t += 365 * 24 * 3_600_000;
    expect(b.canRun()).toBe(false);
    b.onSuccess(); // a late in-flight success must not clear it
    expect(b.canRun()).toBe(false);
    b.reset();
    expect(b.canRun()).toBe(true);
    expect(b.state().status).toBe("closed");
  });

  it("unauthorized opens at once", () => {
    const { b } = make();
    b.onFailure("unauthorized");
    expect(b.state()).toMatchObject({ status: "open", reason: "unauthorized" });
  });
});

describe("guard", () => {
  const setup = (opts: { maxRequests?: number; maxAttempts?: number; threshold?: number } = {}) => {
    const clock = fakeClock();
    const events: GuardEvent[] = [];
    const rate = createRateController({
      windows: [],
      jitter: { baseMs: 0, maxMs: 0 },
      now: clock.now,
      sleep: clock.sleep,
    });
    const breaker = createCircuitBreaker({
      failureThreshold: opts.threshold ?? 5,
      openMs: 60_000,
      now: clock.now,
    });
    const guard = createGuard({
      rate,
      breaker,
      maxRequests: opts.maxRequests ?? 100,
      maxAttempts: opts.maxAttempts,
      onEvent: (e) => events.push(e),
      sleep: clock.sleep,
    });
    return { clock, events, breaker, guard };
  };

  it("returns the value and counts the request", async () => {
    const { guard, events } = setup();
    await expect(guard.run("a", async () => 42)).resolves.toBe(42);
    expect(guard.used()).toBe(1);
    expect(events).toEqual([{ kind: "request", bucket: "a", attempt: 1 }]);
  });

  it("waits retryAfterMs on rate_limited and retries", async () => {
    const { guard, clock } = setup();
    let calls = 0;
    const out = await guard.run("a", async () => {
      if (++calls === 1) throw new SourceError("rate_limited", "429", 70_000);
      return "ok";
    });
    expect(out).toBe("ok");
    expect(calls).toBe(2);
    expect(guard.used()).toBe(2);
    expect(clock.sleeps).toEqual([70_000]);
  });

  it("never waits less than 30 s or more than 15 min after a 429", async () => {
    const { guard, clock } = setup();
    for (const header of [0, 1_000, 99 * 60_000]) {
      let calls = 0;
      await guard.run("a", async () => {
        if (++calls === 1) throw new SourceError("rate_limited", "429", header);
        return "ok";
      });
    }
    expect(clock.sleeps).toEqual([30_000, 30_000, 15 * 60_000]);
  });

  it("falls back to the rate controller wait when retryAfterMs is missing", async () => {
    const clock = fakeClock();
    const rate = createRateController({
      windows: [{ bucket: "*", limit: 1, windowMs: 5_000 }],
      jitter: { baseMs: 0, maxMs: 0 },
      now: clock.now,
      sleep: clock.sleep,
    });
    const guard = createGuard({
      rate,
      breaker: createCircuitBreaker({ failureThreshold: 5, openMs: 1, now: clock.now }),
      maxRequests: 10,
      sleep: clock.sleep,
    });
    let calls = 0;
    await guard.run("a", async () => {
      if (++calls === 1) throw new SourceError("rate_limited", "429");
      return 1;
    });
    // The window says 5 s but a 429 is never retried sooner than the 30 s floor; the acquire after
    // it finds the window already free.
    expect(clock.sleeps).toEqual([30_000]);
  });

  it("retries transport with 1s, 2s backoff then gives up with the last error", async () => {
    const { guard, clock, events } = setup();
    let calls = 0;
    await expect(
      guard.run("a", async () => {
        calls++;
        throw new SourceError("transport", `boom ${calls}`);
      }),
    ).rejects.toMatchObject({ failure: "transport", message: "boom 3" });
    expect(calls).toBe(3);
    expect(clock.sleeps).toEqual([1_000, 2_000]);
    expect(events.filter((e) => e.kind === "retry")).toHaveLength(2);
  });

  it("honours maxAttempts", async () => {
    const { guard } = setup({ maxAttempts: 1 });
    let calls = 0;
    await expect(
      guard.run("a", async () => {
        calls++;
        throw new SourceError("transport", "x");
      }),
    ).rejects.toBeInstanceOf(SourceError);
    expect(calls).toBe(1);
  });

  it("never retries blocked and fails the next run fast", async () => {
    const { guard, events } = setup();
    let calls = 0;
    await expect(
      guard.run("a", async () => {
        calls++;
        throw new SourceError("blocked", "challenge");
      }),
    ).rejects.toMatchObject({ failure: "blocked" });
    expect(calls).toBe(1);
    expect(events).toContainEqual({ kind: "tripped", bucket: "a", failure: "blocked" });

    let second = 0;
    await expect(
      guard.run("a", async () => {
        second++;
        return 1;
      }),
    ).rejects.toMatchObject({ failure: "blocked", message: "circuit open" });
    expect(second).toBe(0);
  });

  it.each(["unauthorized", "not_found", "private", "api_drift", "disabled"] as const)(
    "does not retry %s",
    async (failure) => {
      const { guard } = setup();
      let calls = 0;
      await expect(
        guard.run("a", async () => {
          calls++;
          throw new SourceError(failure, "x");
        }),
      ).rejects.toMatchObject({ failure });
      expect(calls).toBe(1);
    },
  );

  it("an open transport circuit fails fast as transport", async () => {
    const { guard } = setup({ threshold: 1, maxAttempts: 1 });
    await expect(
      guard.run("a", async () => {
        throw new SourceError("transport", "x");
      }),
    ).rejects.toBeInstanceOf(SourceError);
    await expect(guard.run("a", async () => 1)).rejects.toMatchObject({
      failure: "transport",
      message: "circuit open",
    });
  });

  it("stops at the budget without calling fn", async () => {
    const { guard, events } = setup({ maxRequests: 2 });
    await guard.run("a", async () => 1);
    await guard.run("a", async () => 1);
    let calls = 0;
    await expect(
      guard.run("a", async () => {
        calls++;
        return 1;
      }),
    ).rejects.toMatchObject({ failure: "rate_limited", message: "request budget exhausted" });
    expect(calls).toBe(0);
    expect(guard.used()).toBe(2);
    expect(events).toContainEqual({ kind: "budget", bucket: "a" });
  });

  it("counts retries against the budget", async () => {
    const { guard } = setup({ maxRequests: 2, maxAttempts: 5 });
    let calls = 0;
    await expect(
      guard.run("a", async () => {
        calls++;
        throw new SourceError("transport", "x");
      }),
    ).rejects.toMatchObject({ failure: "transport", message: "x" });
    expect(calls).toBe(2);
  });

  it("wraps non-SourceError exceptions as transport and retries them", async () => {
    const { guard } = setup();
    let calls = 0;
    const out = await guard.run("a", async () => {
      if (++calls === 1) throw new TypeError("fetch failed");
      return "ok";
    });
    expect(out).toBe("ok");

    await expect(
      guard.run("a", async () => {
        throw "weird";
      }),
    ).rejects.toMatchObject({ failure: "transport", message: "weird" });
  });

  it("reset clears the budget and the breaker", async () => {
    const { guard } = setup();
    await guard.run("a", async () => 1);
    await expect(
      guard.run("a", async () => {
        throw new SourceError("blocked", "x");
      }),
    ).rejects.toBeInstanceOf(SourceError);
    guard.reset();
    expect(guard.used()).toBe(0);
    await expect(guard.run("a", async () => 1)).resolves.toBe(1);
  });
});
