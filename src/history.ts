// A bounded, coalescing undo/redo history over immutable snapshots of type T. UI- and
// DOM-free so it can be unit-tested. The owner supplies clone(); it records the pre-change
// baseline once per "group" (the owner opens a group with begin() and closes it with
// commit() when its debounce settles), so a burst of edits collapses into a single step.

export class History<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  private baseline: T | null = null;
  private grouping = false;

  constructor(
    private clone: (v: T) => T,
    private max = 100,
  ) {}

  // Start (or reset) the history with the current state as the baseline; clears both stacks.
  reset(state: T): void {
    this.baseline = this.clone(state);
    this.undoStack = [];
    this.redoStack = [];
    this.grouping = false;
  }

  // Mark the start of an edit. The first begin() of a group records the pre-edit baseline on
  // the undo stack and discards the redo stack; further begin()s within the group are no-ops.
  begin(): void {
    if (this.grouping) return;
    if (this.baseline !== null) {
      this.undoStack.push(this.baseline);
      if (this.undoStack.length > this.max) this.undoStack.shift();
    }
    this.redoStack = [];
    this.grouping = true;
  }

  // Close the current group: `state` becomes the committed baseline.
  commit(state: T): void {
    this.baseline = this.clone(state);
    this.grouping = false;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // Undo: push `current` onto the redo stack and return the state to restore, or null if the
  // undo stack is empty. Closes any open group.
  undo(current: T): T | null {
    this.grouping = false;
    const prev = this.undoStack.pop();
    if (prev === undefined) return null;
    this.redoStack.push(this.clone(current));
    this.baseline = prev;
    return prev;
  }

  // Redo: push `current` onto the undo stack and return the state to restore, or null.
  redo(current: T): T | null {
    this.grouping = false;
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.undoStack.push(this.clone(current));
    this.baseline = next;
    return next;
  }
}
