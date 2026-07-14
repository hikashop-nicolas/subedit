import { describe, it, expect } from "vitest";
import { History } from "./history";

// Use a deep clone so the test verifies snapshot isolation too.
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("History", () => {
  it("undoes and redoes committed groups", () => {
    const h = new History<number>(clone);
    h.reset(0);
    expect(h.canUndo()).toBe(false);

    h.begin(); // edit 0 -> 1
    h.commit(1);
    h.begin(); // edit 1 -> 2
    h.commit(2);

    expect(h.canUndo()).toBe(true);
    expect(h.undo(2)).toBe(1);
    expect(h.undo(1)).toBe(0);
    expect(h.undo(0)).toBeNull(); // nothing left
    expect(h.canUndo()).toBe(false);

    expect(h.redo(0)).toBe(1);
    expect(h.redo(1)).toBe(2);
    expect(h.redo(2)).toBeNull();
  });

  it("coalesces edits within a group into one step", () => {
    const h = new History<number>(clone);
    h.reset(0);
    h.begin(); // one logical group: 0 -> 1 -> 2 -> 3
    h.begin();
    h.begin();
    h.commit(3);
    // A single undo returns to the pre-group baseline, not an intermediate value.
    expect(h.undo(3)).toBe(0);
  });

  it("discards the redo stack after a new edit", () => {
    const h = new History<number>(clone);
    h.reset(0);
    h.begin();
    h.commit(1);
    h.undo(1); // back to 0, redo available
    expect(h.canRedo()).toBe(true);
    h.begin(); // a fresh edit invalidates redo
    h.commit(5);
    expect(h.canRedo()).toBe(false);
  });

  it("bounds the undo stack to max entries", () => {
    const h = new History<number>(clone, 3);
    h.reset(0);
    for (let i = 1; i <= 10; i += 1) {
      h.begin();
      h.commit(i);
    }
    // Only 3 undo steps are retained.
    let count = 0;
    let cur = 10;
    while (h.canUndo()) {
      const prev = h.undo(cur);
      if (prev === null) break;
      cur = prev;
      count += 1;
    }
    expect(count).toBe(3);
  });

  it("keeps snapshots isolated from later mutation", () => {
    const h = new History<{ v: number }>(clone);
    h.reset({ v: 0 });
    const state = { v: 1 };
    h.begin();
    h.commit(state);
    state.v = 999; // mutate after commit
    h.begin();
    h.commit({ v: 2 });
    expect(h.undo({ v: 2 })).toEqual({ v: 1 }); // not 999
  });
});
