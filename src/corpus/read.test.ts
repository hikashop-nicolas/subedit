// Does subedit read, from files it did not write, the cues that are actually in them?
//
// The unit tests elsewhere parse strings written a few lines above the assertion, so they can
// only show that subedit agrees with itself. These fixtures came from ffmpeg, or were checked
// against ffmpeg and pysubs2 before being accepted (see scripts/gen-corpus.mjs), so this is
// the first check in the suite that subedit could fail while remaining perfectly consistent.

import { describe, expect, it } from "vitest";
import { detectFormat, parseSubtitles } from "../formats/index";
import { CORPUS_FPS, expectedCues, expectedText, fixtureText, manifest } from "./fixtures";

describe("reading the corpus", () => {
  for (const fx of manifest) {
    describe(fx.name, () => {
      const text = fixtureText(fx);
      const want = expectedCues(fx);

      it("is recognised as the format it is", () => {
        expect(detectFormat(fx.name, text.slice(0, 256))).toBe(fx.format);
      });

      it(`yields ${want.length} cues with the right times and text`, () => {
        const doc = parseSubtitles(text, fx.name);
        expect(doc.format).toBe(fx.format);
        expect(doc.cues.length).toBe(want.length);

        for (let i = 0; i < want.length; i++) {
          const [w, got] = [want[i], doc.cues[i]];
          expect(got.startMs, `cue ${i + 1} start`).toBe(w.start);
          expect(got.text, `cue ${i + 1} text`).toBe(expectedText(fx, w.text));

          // A format with no end times runs each cue up to the next one's start. That rule is
          // checkable even though the ground truth's own ends are not stored in the file.
          if (fx.carries?.ends === false) {
            if (i + 1 < want.length) expect(got.endMs, `cue ${i + 1} end`).toBe(want[i + 1].start);
            else expect(got.endMs, `last cue end`).toBeGreaterThan(got.startMs);
          } else {
            expect(got.endMs, `cue ${i + 1} end`).toBe(w.end);
          }
        }
      });

      it("keeps the line endings, BOM and final newline the file has", () => {
        const doc = parseSubtitles(text, fx.name);
        expect(doc.bom).toBe(text.charCodeAt(0) === 0xfeff);
        expect(doc.eol).toBe(text.includes("\r\n") ? "\r\n" : "\n");
        expect(doc.finalNewline).toBe(/\r?\n$/.test(text));
      });
    });
  }

  it("reads the frame rate a MicroDVD file declares rather than assuming one", () => {
    const fx = manifest.find((m) => m.name === "base.sub")!;
    // The default is 23.976, so a file declaring 25 that is read at the default lands every
    // cue about 4% late. Reading the declaration is what keeps the times above exact.
    expect(parseSubtitles(fixtureText(fx), fx.name).fps).toBe(CORPUS_FPS);
  });
});
