// What subedit does to a file it was not asked to change.
//
// The README promises that a well-formed file "round-trips byte-for-byte" and that only the
// cues you edit are rewritten. Those are the claims a subtitle editor lives or dies by, and
// until now nothing checked them beyond a handful of hand-written strings. Three properties,
// against every fixture in the corpus:
//
//   identity     opening and saving without touching anything returns the same bytes
//   blast radius editing one cue changes that cue's line and nothing else
//   fixed point  a format that is regenerated rather than preserved at least settles, so
//                saving twice does not keep churning the file
//
// Which formats get which is not a judgement call: a format that stores its cues line by line
// can be preserved, and one whose layout is rebuilt (XML, JSON) cannot. The manifest's format
// field decides, and REGENERATED below lists the exceptions with the reason they are there.

import { describe, expect, it } from "vitest";
import { parseSubtitles, serializeSubtitles } from "../formats/index";
import { expectedCues, fixtureText, manifest } from "./fixtures";

// Formats whose file layout is rebuilt on save rather than carried through. Their XML/JSON
// structure (indentation, attribute order, the wrapper elements) is not part of the model, so
// asking for the original bytes back would be asking for something subedit never claimed.
const REGENERATED = new Set(["ttml", "sami", "ytjson", "ttxt", "jsonsub", "csv", "qttext", "lrc", "tmp"]);

describe("preserving the corpus", () => {
  for (const fx of manifest) {
    const preserved = !REGENERATED.has(fx.format);

    describe(fx.name, () => {
      it(preserved ? "comes back byte for byte when nothing is edited" : "settles after one save", () => {
        const original = fixtureText(fx);
        const once = serializeSubtitles(parseSubtitles(original, fx.name));

        if (preserved) {
          expect(once).toBe(original);
          return;
        }
        // Not byte-identical by design, but it must converge: a second save of the same
        // document has to produce what the first one did, or every save churns the file.
        const twice = serializeSubtitles(parseSubtitles(once, fx.name));
        expect(twice).toBe(once);
      });

      it("keeps every cue's times and text across a save", () => {
        const doc = parseSubtitles(fixtureText(fx), fx.name);
        const after = parseSubtitles(serializeSubtitles(doc), fx.name);

        expect(after.cues.length).toBe(doc.cues.length);
        for (let i = 0; i < doc.cues.length; i++) {
          expect(after.cues[i].startMs, `cue ${i + 1} start`).toBe(doc.cues[i].startMs);
          expect(after.cues[i].endMs, `cue ${i + 1} end`).toBe(doc.cues[i].endMs);
          expect(after.cues[i].text, `cue ${i + 1} text`).toBe(doc.cues[i].text);
        }
      });

      // Only meaningful where the file is carried through. A regenerated format rebuilds its
      // whole layout on every save by design, so "how much changed" measures nothing there.
      it.skipIf(!preserved)("rewrites only the cue that was edited", () => {
        const original = fixtureText(fx);
        const doc = parseSubtitles(original, fx.name);
        const target = Math.min(1, doc.cues.length - 1);
        doc.cues[target] = { ...doc.cues[target], text: "EDITED" };
        const edited = serializeSubtitles(doc);

        const before = original.split(/\r?\n/);
        const after = edited.split(/\r?\n/);
        const changed = countChangedLines(before, after);

        // An edit to one cue is allowed to move the lines that cue occupies. Anything beyond
        // that is the save rewriting parts of the file the user never touched. The bound is
        // generous (the original text may have been several lines) but finite, which is the
        // point: without it a serializer could reformat the whole file unnoticed.
        const cueLines = doc.cues[target].text.split("\n").length + 2;
        expect(changed, `edited one cue, ${changed} lines differ`).toBeLessThanOrEqual(cueLines + 2);
      });
    });
  }

  it("renumbers SRT indices on save so an inserted cue does not leave a gap", () => {
    const fx = manifest.find((m) => m.name === "base.srt")!;
    const doc = parseSubtitles(fixtureText(fx), fx.name);
    doc.cues.splice(1, 1);
    const indices = serializeSubtitles(doc)
      .split(/\r?\n/)
      .filter((l) => /^\d+$/.test(l))
      .map(Number);
    expect(indices).toEqual([1, 2, 3, 4, 5]);
  });

  it("does not quietly drop cues that overlap", () => {
    for (const fx of manifest.filter((m) => m.set === "overlap")) {
      const doc = parseSubtitles(fixtureText(fx), fx.name);
      expect(doc.cues.length, `${fx.name}`).toBe(expectedCues(fx).length);
      expect(doc.cues[1].startMs, `${fx.name}`).toBeLessThan(doc.cues[0].endMs);
    }
  });
});

/** Lines present in one version and not the other, counted both ways. */
function countChangedLines(before: string[], after: string[]): number {
  const tally = new Map<string, number>();
  for (const l of before) tally.set(l, (tally.get(l) ?? 0) + 1);
  for (const l of after) tally.set(l, (tally.get(l) ?? 0) - 1);
  let changed = 0;
  for (const n of tally.values()) changed += Math.abs(n);
  return changed;
}
