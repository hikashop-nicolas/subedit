#!/usr/bin/env node
// Generate the subtitle test corpus: one fixture per format, plus the ground truth they all
// encode.
//
// Why this exists: subedit's unit tests are written against strings subedit itself produced,
// so they can only prove it reads back what it wrote. A file that no other player understands
// would pass every one of them. The corpus fixes that by never letting subedit author the
// inputs, and by never taking this script's own idea of a format on trust either:
//
//   - Where ffmpeg has a muxer (ASS, WebVTT, TTML, LRC) the fixture is written BY ffmpeg from
//     a bootstrap SRT, so the dialect is one a real tool emits rather than one we invented.
//   - Everywhere else the fixture is hand-authored here from the format's definition, and then
//     handed to an independent reader (an ffmpeg demuxer, or pysubs2) which must recover the
//     ground truth. A fixture that no outside reader agrees with is rejected, so a misreading
//     of a spec cannot quietly become the expected behaviour.
//   - Five formats (SBV, QuickTime Text, DVD Studio Pro, YouTube JSON, plain JSON) have no
//     external reader available at all. Those fixtures are marked `oracle: null` in the
//     manifest and are golden files: they catch regressions, they do not prove correctness,
//     and the manifest says so rather than letting them look like the others.
//
// The OUTPUT is committed. CI must not need ffmpeg merely to have fixtures, and the
// preservation check needs byte-stable inputs: regenerating on every run would compare a file
// against a different file and prove nothing.
//
// Usage: node scripts/gen-corpus.mjs [--no-validate]

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { normalizeText, readCsv, readJson, readWithFfmpeg, readWithPysubs2, xmlEscape } from "./oracles.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "test-corpus");
const PY = join(ROOT, ".cache/py/bin/python");

// ---------------------------------------------------------------------------------------
// Ground truth
// ---------------------------------------------------------------------------------------

// Every time is a whole number of seconds. That is not laziness: MicroDVD and Spruce quantise
// to video frames, MPL2 to tenths, SubViewer and QuickTime to hundredths, and TMPlayer to
// whole seconds. On a one-second grid every format represents every time exactly, so a
// mismatch anywhere is a real defect and never quantisation noise. Sub-second precision and
// overlapping cues are covered by their own sets below, in the formats that can carry them.
//
// The text is chosen for the hazards it walks into, one per cue:
const BASE = [
  // A comma, which is the field separator in Spruce, SubViewer, DVD Studio Pro and CSV.
  { start: 1000, end: 3000, text: "Hello, world." },
  // A line break, spelled differently by nearly every format (\N, |, [br], <br/>, a real one).
  { start: 4000, end: 6000, text: "Two lines here\nand a second line" },
  // Non-ASCII across three scripts, including a right-to-left one.
  { start: 7000, end: 9000, text: "Accentué ça va 日本語 مرحبا" },
  // Quotes and the three characters XML and HTML formats have to escape.
  { start: 10000, end: 12000, text: 'He said "quoted" and 5 > 3 & 2 < 4' },
  // A long line, the kind that drives the characters-per-second warning.
  { start: 13000, end: 16000, text: "A deliberately long single line of dialogue used to exercise the characters-per-second reading" },
  // Past the hour, where a format that prints only minutes and seconds loses information.
  { start: 3723000, end: 3725000, text: "Past the hour mark" },
];

// Sub-second times, for the formats that store milliseconds. Kept apart from BASE so the
// coarse formats are never asked to represent something they cannot.
const FINE = [
  { start: 1234, end: 3456, text: "Millisecond precision" },
  { start: 3457, end: 5999, text: "Adjacent to the previous cue" },
  { start: 3599999, end: 3600001, text: "Straddling the hour boundary" },
];

// Two cues on screen at once. Legal and common, but a format built around a single current
// state (SAMI, QuickTime Text, TTXT, and the start-only formats) cannot express it: the second
// cue's marker simply ends the first. Those formats get no overlap fixture rather than a
// fixture whose ground truth quietly says something other than what it is named after.
const OVERLAP = [
  { start: 1000, end: 5000, text: "The first speaker, still going" },
  { start: 3000, end: 7000, text: "The second speaker, interrupting" },
];

// ---------------------------------------------------------------------------------------
// Bootstrap: the one file this script writes by hand, in the simplest format there is
// ---------------------------------------------------------------------------------------

/** SRT, spelled out. Short enough to be checked by eye, which is the point. */
function toSrt(cues) {
  return cues
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
    .join("\n");
}

function srtTime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms % 1000, 3)}`;
}

// ---------------------------------------------------------------------------------------
// Hand-authored fixtures, one function per format
// ---------------------------------------------------------------------------------------

const FPS = 25;
const frames = (ms) => Math.round((ms / 1000) * FPS);
const p2 = (n) => String(n).padStart(2, "0");
const hms = (ms) => {
  const t = Math.floor(ms / 1000);
  return { h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60), s: t % 60, ms: ms % 1000 };
};

/**
 * WebVTT, hand-authored rather than produced by ffmpeg.
 *
 * ffmpeg's WebVTT muxer writes `<` and `&` into cue text raw, without escaping them. The
 * WebVTT syntax gives `<` its own meaning (it opens a cue span), so a file written that way
 * is malformed, and ffmpeg's own reader then swallows everything after the `<`. Its reader is
 * fine, and still validates this fixture; it is only the writing side that cannot be trusted
 * here, so this is the one text format the corpus authors itself.
 */
function toVtt(cues) {
  const t = (ms) => {
    const { h, m, s } = hms(ms);
    return `${p2(h)}:${p2(m)}:${p2(s)}.${String(ms % 1000).padStart(3, "0")}`;
  };
  return (
    "WEBVTT\n\n" +
    cues.map((c) => `${t(c.start)} --> ${t(c.end)}\n${xmlEscape(c.text)}`).join("\n\n") +
    "\n"
  );
}

/** MicroDVD: {startFrame}{endFrame}text, '|' breaks, an fps declaration as a {1}{1} entry. */
function toMicroDvd(cues) {
  const lines = [`{1}{1}${FPS}`];
  for (const c of cues) lines.push(`{${frames(c.start)}}{${frames(c.end)}}${c.text.replace(/\n/g, "|")}`);
  return lines.join("\n") + "\n";
}

/** MPL2: [startDs][endDs]text in tenths of a second, '|' breaks. */
function toMpl2(cues) {
  return cues.map((c) => `[${c.start / 100}][${c.end / 100}]${c.text.replace(/\n/g, "|")}`).join("\n") + "\n";
}

/**
 * SubViewer 2.0: a bracket-tag header, then "HH:MM:SS.cc,HH:MM:SS.cc" and text with [br].
 *
 * Written twice, with and without a blank line between the header and the first cue. Both
 * shapes occur in the wild and the difference is exactly one byte, which is the kind of thing
 * a parser drops on the floor and a preservation check is meant to notice.
 */
function toSubViewer(cues, { blankAfterHeader = false } = {}) {
  const t = (ms) => {
    const { h, m, s } = hms(ms);
    return `${p2(h)}:${p2(m)}:${p2(s)}.${p2(Math.round((ms % 1000) / 10))}`;
  };
  const head =
    "[INFORMATION]\n[TITLE]subedit corpus\n[AUTHOR]scripts/gen-corpus.mjs\n[END INFORMATION]\n[SUBTITLE]\n" +
    (blankAfterHeader ? "\n" : "");
  return head + cues.map((c) => `${t(c.start)},${t(c.end)}\n${c.text.replace(/\n/g, "[br]")}`).join("\n\n") + "\n";
}

/**
 * SAMI: a SYNC marker per state change. An end time is expressed by a further SYNC whose
 * paragraph is blank, which is why each cue contributes two markers rather than one.
 */
function toSami(cues) {
  const body = [];
  for (const c of cues) {
    body.push(`<SYNC Start=${c.start}><P Class=ENCC>${xmlEscape(c.text).replace(/\n/g, "<br>")}`);
    body.push(`<SYNC Start=${c.end}><P Class=ENCC>&nbsp;`);
  }
  return `<SAMI>\n<HEAD>\n<TITLE>subedit corpus</TITLE>\n</HEAD>\n<BODY>\n${body.join("\n")}\n</BODY>\n</SAMI>\n`;
}

/** Spruce STL: "HH:MM:SS:FF,HH:MM:SS:FF,text" with '|' breaks and $Key = Value config. */
function toSpruce(cues) {
  const t = (ms) => {
    const { h, m, s } = hms(ms);
    return `${p2(h)}:${p2(m)}:${p2(s)}:${p2(Math.round((ms % 1000) / 1000 * FPS))}`;
  };
  const head = `$FontName = Arial\n$FPS = ${FPS}\n`;
  return head + cues.map((c) => `${t(c.start)},${t(c.end)},${c.text.replace(/\n/g, "|")}`).join("\n") + "\n";
}

/** DVD Studio Pro: Spruce's timecodes with spaces around the separators. */
function toDvdStudio(cues) {
  const t = (ms) => {
    const { h, m, s } = hms(ms);
    return `${p2(h)}:${p2(m)}:${p2(s)}:${p2(Math.round((ms % 1000) / 1000 * FPS))}`;
  };
  return cues.map((c) => `${t(c.start)} , ${t(c.end)} , ${c.text.replace(/\n/g, "|")}`).join("\n") + "\n";
}

/** TMPlayer: "HH:MM:SS:text", start only; the end comes from the next line. */
function toTmp(cues) {
  const t = (ms) => {
    const { h, m, s } = hms(ms);
    return `${p2(h)}:${p2(m)}:${p2(s)}`;
  };
  return cues.map((c) => `${t(c.start)}:${c.text.replace(/\n/g, "|")}`).join("\n") + "\n";
}

/** SBV (YouTube): "H:MM:SS.mmm,H:MM:SS.mmm" then the text lines, blank line between cues. */
function toSbv(cues) {
  const t = (ms) => {
    const { h, m, s } = hms(ms);
    return `${h}:${p2(m)}:${p2(s)}.${String(ms % 1000).padStart(3, "0")}`;
  };
  return cues.map((c) => `${t(c.start)},${t(c.end)}\n${c.text}`).join("\n\n") + "\n";
}

/** QuickTime Text: a {QTtext} descriptor block, then [HH:MM:SS.cc] markers around each line. */
function toQtText(cues) {
  const t = (ms) => {
    const { h, m, s } = hms(ms);
    return `[${p2(h)}:${p2(m)}:${p2(s)}.${p2(Math.round((ms % 1000) / 10))}]`;
  };
  const out = ["{QTtext}{font:Geneva}{size:14}{timeScale:100}{width:320}{height:60}"];
  for (const c of cues) {
    out.push(t(c.start));
    out.push(c.text);
    out.push(t(c.end));
    out.push("");
  }
  return out.join("\n") + "\n";
}

/** CSV: a Start,End,Text header then RFC 4180 rows, quoting anything containing , " or a break. */
function toCsv(cues) {
  const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const t = (ms) => {
    const { h, m, s } = hms(ms);
    return `${p2(h)}:${p2(m)}:${p2(s)},${String(ms % 1000).padStart(3, "0")}`.replace(",", ".");
  };
  return "Start,End,Text\n" + cues.map((c) => `${q(t(c.start))},${q(t(c.end))},${q(c.text)}`).join("\n") + "\n";
}

/** Plain JSON: an array of {start,end,text} in milliseconds. */
function toJsonSubs(cues) {
  return JSON.stringify(cues.map((c) => ({ start: c.start, end: c.end, text: c.text })), null, 2) + "\n";
}

/** YouTube json3: events carrying a start and a duration, with the text in segments. */
function toYtJson(cues) {
  return (
    JSON.stringify(
      {
        events: cues.map((c) => ({ tStartMs: c.start, dDurationMs: c.end - c.start, segs: [{ utf8: c.text }] })),
      },
      null,
      2,
    ) + "\n"
  );
}

/** TTXT (3GPP timed text, GPAC's XML form): TextSample elements with absolute times. */
function toTtxt(cues) {
  const t = (ms) => {
    const { h, m, s } = hms(ms);
    return `${p2(h)}:${p2(m)}:${p2(s)}.${String(ms % 1000).padStart(3, "0")}`;
  };
  const samples = [];
  for (const c of cues) {
    samples.push(`  <TextSample sampleTime="${t(c.start)}" xml:space="preserve">${xmlEscape(c.text)}</TextSample>`);
    samples.push(`  <TextSample sampleTime="${t(c.end)}" text="" />`);
  }
  return (
    '<?xml version="1.0" encoding="UTF-8" ?>\n' +
    '<TextStream version="1.1">\n' +
    '  <TextStreamHeader width="320" height="60" layer="0" translation_x="0" translation_y="0">\n' +
    '    <TextSampleDescription horizontalJustification="center" verticalJustification="bottom"' +
    ' backColor="0 0 0 0" scroll="None">\n' +
    '      <FontTable><FontTableEntry fontName="Serif" fontID="1"/></FontTable>\n' +
    "    </TextSampleDescription>\n" +
    "  </TextStreamHeader>\n" +
    samples.join("\n") +
    "\n</TextStream>\n"
  );
}

// ---------------------------------------------------------------------------------------
// The fixture table
// ---------------------------------------------------------------------------------------

// `oracle` names the independent reader that must agree with the ground truth before the
// fixture is accepted. `null` means no such reader exists for this format, and the fixture is
// a golden file rather than a verified one: it catches regressions, it does not prove
// correctness, and the manifest says so.
//
// Which reader is named per format is not arbitrary. Each was tried and kept only where it is
// actually right (see `blind` below for the exceptions that were kept anyway):
//   - ffmpeg reads WebVTT entities correctly; pysubs2 hands them back undecoded.
//   - pysubs2 reads TTML and SAMI entities correctly; ffmpeg hands SAMI's back undecoded.
//   - ffmpeg's Spruce STL reader treats the frame field as hundredths of a second regardless
//     of the file's declared frame rate, so it is not used for Spruce at all.
//
// `carries` records what the format can actually express, so a check never faults a fixture
// for losing something the format has no way to store:
//   ends        - real end times (TMPlayer and LRC end at the next cue's start instead)
//   lineBreaks  - a multi-line cue (LRC gives every line its own timestamp)
//
// `blind` names something the oracle is known not to do, so the expectation is adjusted to
// what that reader actually returns rather than the check being skipped:
//   entities    - the reader returns &amp; / &lt; / &gt; as written instead of decoding them
const FIXTURES = [
  { name: "base.srt", format: "srt", author: "hand", oracle: { kind: "ffmpeg", id: "srt" } },
  { name: "base.ass", format: "ass", author: "ffmpeg", oracle: { kind: "pysubs2", id: "ass" } },
  { name: "base.vtt", format: "vtt", author: "hand", oracle: { kind: "ffmpeg", id: "webvtt" } },
  { name: "base.ttml", format: "ttml", author: "ffmpeg", oracle: { kind: "pysubs2", id: "ttml" } },
  { name: "base.sub", format: "sub", author: "hand", oracle: { kind: "ffmpeg", id: "microdvd" } },
  { name: "base.mpl2", format: "mpl2", author: "hand", oracle: { kind: "ffmpeg", id: "mpl2" } },
  { name: "base.subviewer.sub", format: "subviewer", author: "hand", oracle: { kind: "ffmpeg", id: "subviewer" } },
  { name: "spaced.subviewer.sub", format: "subviewer", author: "hand", writerOpts: { blankAfterHeader: true }, oracle: { kind: "ffmpeg", id: "subviewer" } },
  { name: "base.smi", format: "sami", author: "hand", oracle: { kind: "ffmpeg", id: "sami", blind: "entities" } },
  { name: "base.stl", format: "spruce", author: "hand", oracle: null },
  { name: "base.dvdsp.txt", format: "dvdsp", author: "hand", oracle: null },
  { name: "base.tmp.txt", format: "tmp", author: "hand", oracle: { kind: "pysubs2", id: "tmp" }, carries: { ends: false } },
  { name: "base.sbv", format: "sbv", author: "hand", oracle: null },
  { name: "base.qt.txt", format: "qttext", author: "hand", oracle: null },
  { name: "base.csv", format: "csv", author: "hand", oracle: { kind: "csv" } },
  { name: "base.json", format: "jsonsub", author: "hand", oracle: { kind: "json" } },
  { name: "base.json3", format: "ytjson", author: "hand", oracle: { kind: "json" } },
  { name: "base.ttxt", format: "ttxt", author: "hand", oracle: null },
  { name: "base.lrc", format: "lrc", author: "ffmpeg", oracle: { kind: "ffmpeg", id: "lrc" }, carries: { ends: false, lineBreaks: false } },
  // Sub-second times, only in the formats that store them.
  { name: "fine.srt", format: "srt", set: "fine", author: "hand", oracle: { kind: "ffmpeg", id: "srt" } },
  { name: "fine.vtt", format: "vtt", set: "fine", author: "hand", oracle: { kind: "ffmpeg", id: "webvtt" } },
  // No fine.ass: ASS stores centiseconds, so the set has nothing to say there. How a
  // millisecond time should be rounded into one is a policy rather than a rule (ffmpeg floors
  // starts and rounds ends up), and a corpus is the wrong place to enshrine one tool's choice.
  { name: "fine.sbv", format: "sbv", set: "fine", author: "hand", oracle: null },
  { name: "fine.json", format: "jsonsub", set: "fine", author: "hand", oracle: { kind: "json" } },
  // Overlapping cues, only in the formats that can hold two at once.
  { name: "overlap.srt", format: "srt", set: "overlap", author: "hand", oracle: { kind: "ffmpeg", id: "srt" } },
  { name: "overlap.ass", format: "ass", set: "overlap", author: "ffmpeg", oracle: { kind: "pysubs2", id: "ass" } },
  { name: "overlap.vtt", format: "vtt", set: "overlap", author: "hand", oracle: { kind: "ffmpeg", id: "webvtt" } },
  { name: "overlap.sub", format: "sub", set: "overlap", author: "hand", oracle: { kind: "ffmpeg", id: "microdvd" } },
  { name: "overlap.json", format: "jsonsub", set: "overlap", author: "hand", oracle: { kind: "json" } },
  // Line-ending and BOM variants, which exist so the preservation check has something to
  // preserve beyond the cues themselves.
  { name: "crlf.srt", format: "srt", variant: "crlf", author: "hand", oracle: { kind: "ffmpeg", id: "srt" } },
  { name: "bom.srt", format: "srt", variant: "bom", author: "hand", oracle: { kind: "ffmpeg", id: "srt" } },
  { name: "bom-crlf.vtt", format: "vtt", variant: "bom-crlf", author: "hand", oracle: { kind: "ffmpeg", id: "webvtt" } },
  { name: "crlf.ass", format: "ass", variant: "crlf", author: "ffmpeg", oracle: { kind: "pysubs2", id: "ass" } },
];

const HAND_WRITERS = {
  srt: toSrt,
  vtt: toVtt,
  sub: toMicroDvd,
  mpl2: toMpl2,
  subviewer: toSubViewer,
  sami: toSami,
  spruce: toSpruce,
  dvdsp: toDvdStudio,
  tmp: toTmp,
  sbv: toSbv,
  qttext: toQtText,
  csv: toCsv,
  jsonsub: toJsonSubs,
  ytjson: toYtJson,
  ttxt: toTtxt,
};

// ffmpeg muxer names, for the fixtures it authors.
const FFMPEG_MUXER = { ass: "ass", vtt: "webvtt", ttml: "ttml", lrc: "lrc" };

// ---------------------------------------------------------------------------------------

function main() {
  const validate = !process.argv.includes("--no-validate");
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const tmp = join(tmpdir(), `subedit-corpus-${process.pid}`);
  mkdirSync(tmp, { recursive: true });

  const SETS = { base: BASE, fine: FINE, overlap: OVERLAP };
  const bootstrap = {};
  for (const [name, cues] of Object.entries(SETS)) {
    bootstrap[name] = join(tmp, `${name}.srt`);
    writeFileSync(bootstrap[name], toSrt(cues));
  }

  const manifest = [];
  const problems = [];

  for (const fx of FIXTURES) {
    const cues = SETS[fx.set ?? "base"];
    const path = join(OUT, fx.name);

    if (fx.author === "ffmpeg") {
      const muxer = FFMPEG_MUXER[fx.format];
      execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", bootstrap[fx.set ?? "base"], "-f", muxer, path]);
    } else {
      writeFileSync(path, HAND_WRITERS[fx.format](cues, fx.writerOpts));
    }

    applyVariant(path, fx.variant);

    const entry = { ...fx, cues: cues.length };
    if (validate && fx.oracle) {
      const found = validateFixture(path, fx, cues);
      if (found) problems.push(`${fx.name}: ${found}`);
    }
    manifest.push(entry);
  }

  rmSync(tmp, { recursive: true, force: true });

  writeFileSync(join(OUT, "truth.json"), JSON.stringify({ base: BASE, fine: FINE, overlap: OVERLAP, fps: FPS }, null, 2) + "\n");
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  if (problems.length) {
    console.error("\nThese fixtures were not confirmed by an independent reader:\n");
    for (const p of problems) console.error(`  ${p}`);
    console.error("\nThe corpus was still written, so the disagreement can be inspected, but it is not");
    console.error("trustworthy ground truth until every line above is either fixed or explained.\n");
    process.exit(1);
  }

  const verified = manifest.filter((m) => m.oracle).length;
  console.log(`${manifest.length} fixtures written to test-corpus/ (${verified} confirmed by an independent reader).`);
}

/** Rewrite a fixture with the line endings / BOM its variant calls for. */
function applyVariant(path, variant) {
  if (!variant) return;
  let text = readFileSync(path, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  if (variant.includes("crlf")) text = text.replace(/\n/g, "\r\n");
  if (variant.includes("bom")) text = "﻿" + text;
  writeFileSync(path, text);
}

/**
 * Hand the fixture to its independent reader and check the reader recovers the ground truth.
 * Returns a description of the disagreement, or null when the reader agrees.
 */
function validateFixture(path, fx, truth) {
  let got;
  try {
    if (fx.oracle.kind === "ffmpeg") got = readWithFfmpeg(path, fx.oracle.id);
    else if (fx.oracle.kind === "pysubs2") got = readWithPysubs2(path, fx.oracle.id);
    else if (fx.oracle.kind === "json") got = readJson(path, fx.format);
    else if (fx.oracle.kind === "csv") got = readCsv(path);
    else return `unknown oracle kind ${fx.oracle.kind}`;
  } catch (e) {
    return `the ${fx.oracle.kind} reader failed: ${String(e.message ?? e).split("\n")[0]}`;
  }

  const carries = fx.carries ?? {};
  const want = expectedCues(truth, carries, fx.oracle);
  if (got.length !== want.length) return `reader found ${got.length} cues, expected ${want.length}`;

  for (let i = 0; i < want.length; i++) {
    const [w, h] = [want[i], got[i]];
    if (h.start !== w.start) return `cue ${i + 1} starts at ${h.start} ms, expected ${w.start}`;
    if (carries.ends !== false && h.end !== w.end) return `cue ${i + 1} ends at ${h.end} ms, expected ${w.end}`;
    if (normalizeText(h.text) !== normalizeText(w.text)) {
      return `cue ${i + 1} text is ${JSON.stringify(h.text)}, expected ${JSON.stringify(w.text)}`;
    }
  }
  return null;
}

/**
 * The ground truth as this fixture's format and reader can actually return it.
 *
 * Both adjustments below are the format's or the reader's documented behaviour, written out
 * here so the expectation stays visible. Neither weakens the check: a fixture still has to
 * match something exact, it is just the right exact thing.
 */
function expectedCues(truth, carries, oracle) {
  let want = truth;
  // LRC timestamps a line, not a cue, so a two-line cue arrives as two entries sharing a start.
  if (carries.lineBreaks === false) {
    want = want.flatMap((c) => c.text.split("\n").map((line) => ({ ...c, text: line })));
  }
  // A reader that does not decode character references returns the file's bytes as written.
  if (oracle?.blind === "entities") {
    want = want.map((c) => ({ ...c, text: xmlEscape(c.text) }));
  }
  return want;
}
// Only when run, never when imported: importing this file to reuse a writer must not
// silently regenerate the corpus underneath whatever is doing the importing.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
