// Emit, into .cache/written/, one file per format for scripts/check-writers.mjs to hand to an
// independent reader.
//
// This is the half the suite could not reach on its own. Everything else here proves subedit
// reads back what it wrote, which stays true even if what it wrote is a file no other tool
// understands. Writing the files from a vitest run is the only practical way to drive subedit's
// TypeScript from a plain node script, and it is the same split richdoc and sheetedit use.
//
// The route taken is the one a person takes: open a file, choose a different format from the
// toolbar, save. So this covers the conversion path too, not just the serializers.

import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SubtitleFormat } from "../cue";
import { convertDoc, parseSubtitles, serializeSubtitles } from "../formats/index";
import { fixtureText, manifest } from "./fixtures";

const OUT = new URL("../../.cache/written/", import.meta.url).pathname;

// The filename each format is written under, which is also what the check reads back. The
// extension matters: it is how the readers on the other side pick a demuxer.
const TARGETS: Record<SubtitleFormat, string> = {
  srt: "out.srt",
  vtt: "out.vtt",
  ass: "out.ass",
  sub: "out.sub",
  lrc: "out.lrc",
  ttml: "out.ttml",
  sbv: "out.sbv",
  subviewer: "out.subviewer.sub",
  sami: "out.smi",
  mpl2: "out.mpl2",
  ytjson: "out.json3",
  spruce: "out.stl",
  tmp: "out.tmp.txt",
  csv: "out.csv",
  qttext: "out.qt.txt",
  dvdsp: "out.dvdsp.txt",
  jsonsub: "out.json",
  ttxt: "out.ttxt",
};

describe("writing every format", () => {
  const source = manifest.find((m) => m.name === "base.srt")!;

  it("converts the base fixture into all 18 formats", () => {
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });

    const original = parseSubtitles(fixtureText(source), source.name);
    for (const [format, filename] of Object.entries(TARGETS) as [SubtitleFormat, string][]) {
      // Re-parse per target: convertDoc mutates trivia on the doc it is given, and a chain of
      // conversions through one object would test something no user ever does.
      const doc = convertDoc(parseSubtitles(fixtureText(source), source.name), format);
      const text = serializeSubtitles(doc);
      expect(text.length, `${format} serialized to nothing`).toBeGreaterThan(0);
      writeFileSync(join(OUT, filename), text);
    }
    expect(original.cues.length).toBe(6);
  });
});
