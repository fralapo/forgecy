import { afterEach, describe, expect, it, vi } from "vitest";
import { startHeartbeat } from "../src";

afterEach(() => vi.useRealTimers());

describe("startHeartbeat", () => {
  it("beats on the interval until stopped, and survives a failing beat", async () => {
    vi.useFakeTimers();
    const beat = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue(undefined);
    const onError = vi.fn();
    const stop = startHeartbeat(beat, 1000, onError);
    await vi.advanceTimersByTimeAsync(3000);
    expect(beat).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
    stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect(beat).toHaveBeenCalledTimes(3);
  });
});
