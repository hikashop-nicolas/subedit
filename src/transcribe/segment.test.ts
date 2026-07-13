import { describe, it, expect } from "vitest";
import { segmentToCues, wrapLines } from "./segment";
import type { WordTs } from "./backend";

// Build evenly-spaced words starting at t=0, each `dur` ms with `gap` ms between them.
function words(texts: string[], dur = 300, gap = 50, start = 0): WordTs[] {
  let t = start;
  return texts.map((text) => {
    const w = { text, startMs: t, endMs: t + dur };
    t += dur + gap;
    return w;
  });
}

describe("wrapLines", () => {
  it("keeps a short line on one row", () => {
    expect(wrapLines("Hello there", 42, 2)).toBe("Hello there");
  });
  it("balances a long line across two rows", () => {
    const out = wrapLines("the quick brown fox jumps over the lazy dog again now", 20, 2);
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    // balanced: the two lines are within a few chars of each other
    expect(Math.abs(lines[0].length - lines[1].length)).toBeLessThan(10);
  });
  it("splits spaceless (CJK) text by character count", () => {
    const out = wrapLines("あいうえおかきくけこさしすせそ", 6, 2);
    expect(out.split("\n").length).toBeGreaterThan(1);
  });
});

describe("segmentToCues", () => {
  it("breaks on sentence-ending punctuation", () => {
    const ws = words(["This ", "is ", "one ", "sentence. ", "And ", "here ", "is ", "another."]);
    const cues = segmentToCues(ws, { minSentenceChars: 5 });
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toMatch(/sentence\.$/);
    expect(cues[1].text).toMatch(/another\.$/);
  });

  it("breaks on a long silence gap", () => {
    const a = words(["hello ", "world"], 300, 50, 0);
    const b = words(["much ", "later"], 300, 50, 5000); // 5 s gap
    const cues = segmentToCues([...a, ...b], { gapThresholdMs: 700 });
    expect(cues).toHaveLength(2);
    expect(cues[0].startMs).toBe(0);
    expect(cues[1].startMs).toBe(5000);
  });

  it("breaks when the box would overflow", () => {
    const ws = words(Array.from({ length: 30 }, (_, i) => `word${i} `), 100, 20);
    const cues = segmentToCues(ws, { maxCharsPerLine: 20, maxLines: 2 });
    expect(cues.length).toBeGreaterThan(1);
    for (const c of cues) expect(c.text.replace(/\n/g, " ").length).toBeLessThanOrEqual(20 * 2 + 2);
  });

  it("stretches a very short cue to the minimum duration", () => {
    const ws = words(["Hi."], 120, 0, 0); // 120 ms only
    const cues = segmentToCues(ws, { minDurationMs: 1000 });
    expect(cues[0].endMs - cues[0].startMs).toBeGreaterThanOrEqual(1000);
  });

  it("never overlaps the next cue", () => {
    const a = words(["one. "], 120, 0, 0);
    const b = words(["two"], 300, 0, 800);
    const cues = segmentToCues([...a, ...b], { minDurationMs: 1000, minGapMs: 100, minSentenceChars: 3 });
    expect(cues).toHaveLength(2);
    expect(cues[0].endMs).toBeLessThanOrEqual(cues[1].startMs - 100);
  });

  it("returns nothing for empty input", () => {
    expect(segmentToCues([])).toEqual([]);
  });
});
