import { JOB_BACKOFF_MS } from "@forgecy/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  NeedsAttentionError,
  UnrecoverableError,
  defineJob,
  errorMessage,
  forgecyBackoff,
  getJobDefinition,
  handle,
  isNeedsAttentionError,
  isUnrecoverableError,
  jobDefinitions,
  systemPingJob,
} from "../src";

describe("registry", () => {
  it("registers system.ping", () => {
    expect(jobDefinitions.get("system.ping")).toBe(systemPingJob);
    expect(getJobDefinition("system.ping").queue).toBe("default");
    expect(systemPingJob.payload.safeParse({ message: "ciao" }).success).toBe(true);
    expect(systemPingJob.payload.safeParse({}).success).toBe(false);
  });

  it("validates kinds, queues and duplicates", () => {
    expect(() =>
      defineJob({ kind: "Bad Kind", queue: "default", payload: z.object({}) }),
    ).toThrow();
    expect(() => defineJob({ kind: "nodot", queue: "default", payload: z.object({}) })).toThrow();
    expect(() =>
      defineJob({ kind: "unit.q", queue: "nope" as "default", payload: z.object({}) }),
    ).toThrow();
    const def = defineJob({ kind: "unit.once", queue: "ai", payload: z.object({ n: z.number() }) });
    expect(defineJob(def)).toBe(def);
    expect(() => defineJob({ kind: "unit.once", queue: "ai", payload: z.object({}) })).toThrow(
      /already defined/,
    );
    expect(() => getJobDefinition("unit.missing")).toThrow();
  });

  it("builds typed handler maps", async () => {
    const handlers = handle(systemPingJob, async (p) => ({ echo: p.message }));
    expect(Object.keys(handlers)).toEqual(["system.ping"]);
    expect(await handlers["system.ping"]({ message: "x" }, {} as never)).toEqual({ echo: "x" });
  });
});

describe("backoff", () => {
  it("follows the spec: now, +5 s, +30 s", () => {
    expect(JOB_BACKOFF_MS).toEqual([0, 5000, 30000]);
    expect(forgecyBackoff(1)).toBe(5000);
    expect(forgecyBackoff(2)).toBe(30000);
    expect(forgecyBackoff(5)).toBe(30000);
    expect(forgecyBackoff(0)).toBe(5000);
  });
});

describe("errors", () => {
  it("classifies errors", () => {
    expect(isNeedsAttentionError(new NeedsAttentionError("x"))).toBe(true);
    expect(isNeedsAttentionError(new Error("x"))).toBe(false);
    expect(isUnrecoverableError(new UnrecoverableError("x"))).toBe(true);
    expect(errorMessage(new Error("a".repeat(5000))).length).toBe(2000);
    expect(errorMessage("plain")).toBe("plain");
  });
});
