#!/usr/bin/env node
// Hand every file subedit wrote to a reader that shares no code with it, and check the cues
// come back.
//
// Run after `vitest run src/corpus/write-corpus.test.ts`, which produces .cache/written/ by
// converting the base fixture into all 18 formats. That test can only assert that subedit
// reads its own output; this is where an outside opinion arrives.
//
// Five formats have no independent reader (see scripts/oracles.mjs for which and why). They
// are reported as unchecked rather than passed, because a check that silently covers 13 of 18
// formats while looking like it covers all of them is worse than no check.
//
// Usage: node scripts/check-writers.mjs

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ORACLES, normalizeText, readWithOracle, xmlEscape } from "./oracles.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const WRITTEN = join(ROOT, ".cache/written/formats");
const CORPUS = join(ROOT, "test-corpus");

// Must match TARGETS in src/corpus/write-corpus.test.ts.
const TARGETS = {
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

// Formats that store no end time: a cue runs until the next one starts.
const NO_ENDS = new Set(["lrc", "tmp"]);

// Formats with nowhere to put a line break, which subedit writes as a space.
//
// LRC could instead give each line its own timestamp, which is what a reader sees when it
// reads such a file back, and is why the LRC *fixture* is expected to yield more cues than it
// has. Writing it that way would mean inventing a start time for the second line or repeating
// the first, and repeating it produces a zero-length cue. A space keeps one cue per cue.
const SPACE_JOINED = new Set(["lrc"]);

function main() {
  if (!existsSync(WRITTEN)) {
    console.error("No output directory: run `vitest run src/corpus/write-corpus.test.ts` first.");
    process.exit(1);
  }
  const truth = JSON.parse(readFileSync(join(CORPUS, "truth.json"), "utf8")).base;

  const failures = [];
  const unchecked = [];
  let checked = 0;

  for (const [format, filename] of Object.entries(TARGETS)) {
    const path = join(WRITTEN, filename);
    if (!existsSync(path)) {
      failures.push(`${format}: subedit wrote no file`);
      continue;
    }
    if (!ORACLES[format]) {
      unchecked.push(format);
      continue;
    }

    const problem = check(path, format, truth);
    if (problem) failures.push(`${format} (${filename}): ${problem}`);
    else checked += 1;
  }

  if (unchecked.length) {
    console.log(`Not checked, no independent reader exists: ${unchecked.join(", ")}.`);
  }
  if (failures.length) {
    console.error(`\nAn independent reader disagreed with what subedit wrote:\n`);
    for (const f of failures) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }
  console.log(`${checked} of ${Object.keys(TARGETS).length} formats confirmed by an independent reader.`);
}

function check(path, format, truth) {
  let got;
  try {
    got = readWithOracle(path, format);
  } catch (e) {
    // A reader refusing the file outright is the loudest possible failure: subedit produced
    // something its own parser accepts and nothing else does.
    return `the reader could not open it: ${String(e.message ?? e).split("\n")[0]}`;
  }

  let want = truth;
  if (SPACE_JOINED.has(format)) {
    want = want.map((c) => ({ ...c, text: c.text.replace(/\n/g, " ") }));
  }
  if (ORACLES[format].blind === "entities") {
    want = want.map((c) => ({ ...c, text: xmlEscape(c.text) }));
  }

  if (got.length !== want.length) return `reader found ${got.length} cues, expected ${want.length}`;

  for (let i = 0; i < want.length; i++) {
    const [w, h] = [want[i], got[i]];
    if (h.start !== w.start) return `cue ${i + 1} starts at ${h.start} ms, expected ${w.start}`;
    if (!NO_ENDS.has(format) && h.end !== w.end) return `cue ${i + 1} ends at ${h.end} ms, expected ${w.end}`;
    if (normalizeText(h.text) !== normalizeText(w.text)) {
      return `cue ${i + 1} text is ${JSON.stringify(h.text)}, expected ${JSON.stringify(w.text)}`;
    }
  }
  return null;
}

main();
