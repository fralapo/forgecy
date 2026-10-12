import { describe, expect, it } from "vitest";
import { COALESCE_MS, emptyHistory, HISTORY_LIMIT, record, redo, undo } from "./editor-history";

describe("editor history", () => {
  it("undoes and redoes through snapshots", () => {
    let h = record(emptyHistory<string>(), "a", 0);
    h = record(h, "b", 10_000);
    const back = undo(h, "c")!;
    expect(back.present).toBe("b");
    const back2 = undo(back.history, back.present)!;
    expect(back2.present).toBe("a");
    expect(undo(back2.history, back2.present)).toBeNull();
    const fwd = redo(back2.history, back2.present)!;
    expect(fwd.present).toBe("b");
    expect(redo(fwd.history, fwd.present)!.present).toBe("c");
  });

  it("a new edit after an undo drops the redo branch", () => {
    const h = record(emptyHistory<string>(), "a", 0);
    const { history, present } = undo(h, "b")!;
    expect(history.future).toEqual(["b"]);
    const next = record(history, present, 10_000);
    expect(next.future).toEqual([]);
    expect(redo(next, "x")).toBeNull();
  });

  it("groups quick consecutive edits into one step", () => {
    let h = record(emptyHistory<string>(), "a", 1000);
    h = record(h, "ab", 1000 + COALESCE_MS - 1);
    h = record(h, "abc", 1000 + COALESCE_MS + 100);
    expect(h.past).toEqual(["a"]);
    h = record(h, "abcd", 1000 + 3 * COALESCE_MS);
    expect(h.past).toEqual(["a", "abcd"]);
  });

  it("keeps at most 30 steps, dropping the oldest", () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = record(h, i, i * 10_000);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toBe(5);
    expect(h.past.at(-1)).toBe(HISTORY_LIMIT + 4);
  });

  it("caps the history when redoing too", () => {
    const full = { past: Array.from({ length: HISTORY_LIMIT }, (_, i) => i), future: [99], at: 0 };
    const step = redo(full, 50)!;
    expect(step.history.past).toHaveLength(HISTORY_LIMIT);
    expect(step.history.past.at(-1)).toBe(50);
  });
});
