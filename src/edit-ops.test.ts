import { describe, it, expect } from "vitest";
import { mergeCuesAt, splitCueAt, clampStart, clampEnd, findProblems, matchCues, replaceAllInCues } from "./edit-ops";
import { blankCue, type Cue } from "./cue";

function cue(startMs: number, endMs: number, text: string): Cue {
  return { ...blankCue(startMs, endMs, text) };
}

describe("mergeCuesAt", () => {
  it("joins text with a space and spans the times", () => {
    const cues = [cue(0, 1000, "Hello"), cue(1500, 2500, "world"), cue(3000, 4000, "end")];
    const out = mergeCuesAt(cues, 0)!;
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe("Hello world");
    expect(out[0].startMs).toBe(0);
    expect(out[0].endMs).toBe(2500);
    expect(out[1].text).toBe("end");
  });
  it("returns null when there is no next cue", () => {
    expect(mergeCuesAt([cue(0, 1000, "only")], 0)).toBeNull();
  });
  it("does not mutate the input array", () => {
    const cues = [cue(0, 1000, "a"), cue(1000, 2000, "b")];
    mergeCuesAt(cues, 0);
    expect(cues).toHaveLength(2);
  });
});

describe("splitCueAt", () => {
  it("splits at the caret, dividing time by text length", () => {
    const cues = [cue(0, 1000, "abcd efgh")]; // 9 chars, split at 4 ("abcd")
    const res = splitCueAt(cues, 0, 4, "srt")!;
    expect(res.cues).toHaveLength(2);
    expect(res.cues[0].text).toBe("abcd");
    expect(res.cues[1].text).toBe("efgh");
    // 4/8 non-space chars -> mid ~= 500ms
    expect(res.cues[0].endMs).toBe(res.cues[1].startMs);
    expect(res.cues[0].endMs).toBeGreaterThan(0);
    expect(res.cues[0].endMs).toBeLessThan(1000);
  });
  it("falls back to the midpoint when the caret is at an edge", () => {
    const res = splitCueAt([cue(0, 1000, "abcdef")], 0, -1, "srt")!;
    expect(res.cues[0].text).toBe("abc");
    expect(res.cues[1].text).toBe("def");
  });
  it("carries ASS fields to the second cue", () => {
    const c = cue(0, 1000, "one two");
    c.assKind = "Dialogue";
    c.assFields = { Style: "Title", Layer: "0" };
    const res = splitCueAt([c], 0, 3, "ass")!;
    expect(res.cues[1].assFields).toEqual({ Style: "Title", Layer: "0" });
    expect(res.cues[1].assKind).toBe("Dialogue");
  });
});

describe("clampStart / clampEnd", () => {
  it("keeps at least a 1ms span", () => {
    const c = cue(1000, 2000, "x");
    expect(clampStart(c, 2500)).toBe(1999); // can't pass the end
    expect(clampStart(c, 1200)).toBe(1200);
    expect(clampEnd(c, 500)).toBe(1001); // can't precede the start
    expect(clampEnd(c, 1800)).toBe(1800);
  });
});

describe("findProblems", () => {
  it("flags overlap, too-fast and too-long", () => {
    const cues = [
      cue(0, 3000, "ends after the next starts"), // overlaps [1]
      cue(2000, 2500, "This is a very long line of text that reads far too quickly for its slot"), // too fast
      cue(3000, 12000, "long"), // 9s -> too long
    ];
    const probs = findProblems(cues, { cpsBad: 27, maxDurMs: 7000 });
    const kinds = probs.map((p) => p.kind);
    expect(kinds).toContain("overlap");
    expect(kinds).toContain("tooFast");
    expect(kinds).toContain("tooLong");
    expect(findProblems([cue(0, 2000, "fine")], { cpsBad: 27, maxDurMs: 7000 })).toHaveLength(0);
  });
});

describe("matchCues / replaceAllInCues", () => {
  it("matches case-insensitively", () => {
    const cues = [cue(0, 1, "Hello World"), cue(1, 2, "goodbye"), cue(2, 3, "hello again")];
    expect(matchCues(cues, "hello")).toHaveLength(2);
    expect(matchCues(cues, "")).toHaveLength(0);
  });
  it("replaces all occurrences and reports the count", () => {
    const cues = [cue(0, 1, "cat cat"), cue(1, 2, "dog"), cue(2, 3, "CAT")];
    const n = replaceAllInCues(cues, "cat", "fox");
    expect(n).toBe(2); // two cues changed
    expect(cues[0].text).toBe("fox fox");
    expect(cues[2].text).toBe("fox");
    expect(cues[1].text).toBe("dog");
  });
  it("treats the query literally (no regex injection)", () => {
    const cues = [cue(0, 1, "a.b a+b")];
    expect(replaceAllInCues(cues, "a.b", "X")).toBe(1);
    expect(cues[0].text).toBe("X a+b");
  });
});
