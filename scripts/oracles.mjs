// The independent readers, and which one to trust for which format.
//
// Shared by the corpus generator (which uses them to validate the fixtures it writes) and the
// writer check (which uses them to read what subedit produces). One table, so the two cannot
// drift into disagreeing about who the authority is for a format.
//
// Every entry here was tried before it was written down. Where a reader is wrong it is not
// listed, and where it is wrong in one narrow way it carries a `blind` note instead:
//
//   - ffmpeg's WebVTT muxer does not escape "<" or "&" in cue text, so it cannot author a
//     WebVTT fixture. Its WebVTT *reader* is correct and is used.
//   - pysubs2's WebVTT reader returns character references undecoded, so it is not used there.
//   - ffmpeg's SAMI reader returns them undecoded too, but is otherwise right, so it is used
//     with `blind: "entities"` and the expectation is adjusted to what it actually returns.
//   - ffmpeg's Spruce STL reader reads the frame field as hundredths of a second whatever the
//     file's declared frame rate, so Spruce has no external reader at all.
//   - SBV, QuickTime Text, DVD Studio Pro and TTXT have no independent reader available.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PY = join(ROOT, ".cache/py/bin/python");

/** Which reader is authoritative for each of subedit's formats, or null where none is. */
export const ORACLES = {
  srt: { kind: "ffmpeg", id: "srt" },
  vtt: { kind: "ffmpeg", id: "webvtt" },
  ass: { kind: "pysubs2", id: "ass" },
  ttml: { kind: "pysubs2", id: "ttml" },
  sub: { kind: "ffmpeg", id: "microdvd" },
  mpl2: { kind: "ffmpeg", id: "mpl2" },
  subviewer: { kind: "ffmpeg", id: "subviewer" },
  sami: { kind: "ffmpeg", id: "sami", blind: "entities" },
  tmp: { kind: "pysubs2", id: "tmp" },
  lrc: { kind: "ffmpeg", id: "lrc" },
  csv: { kind: "csv" },
  jsonsub: { kind: "json" },
  ytjson: { kind: "json" },
  spruce: null,
  dvdsp: null,
  sbv: null,
  qttext: null,
  ttxt: null,
};

export const xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Read a file with the reader the table names for `format`. */
export function readWithOracle(path, format) {
  const oracle = ORACLES[format];
  if (!oracle) throw new Error(`no independent reader for ${format}`);
  if (oracle.kind === "ffmpeg") return readWithFfmpeg(path, oracle.id);
  if (oracle.kind === "pysubs2") return readWithPysubs2(path, oracle.id);
  if (oracle.kind === "json") return readJson(path, format);
  if (oracle.kind === "csv") return readCsv(path);
  throw new Error(`unknown reader kind ${oracle.kind}`);
}

/**
 * Read with an explicitly named ffmpeg demuxer.
 *
 * The demuxer is always forced rather than probed. ffmpeg's probing gets several of these
 * wrong (it will not pick MPL2 from either the content or the extension), and a file checked
 * by the wrong demuxer is worse than one not checked at all.
 */
export function readWithFfmpeg(path, demuxer) {
  const srt = execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-f", demuxer, "-i", path, "-f", "srt", "-"],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return parseSrtBack(srt);
}

export function readWithPysubs2(path, format) {
  // stderr is captured rather than inherited: when pysubs2 rejects a file it raises, and a
  // Python stack trace printed above the actual verdict buries the one line that matters.
  const out = execFileSync(PY, [join(ROOT, "scripts/read-with-pysubs2.py"), path, format], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out);
}

export function readJson(path, format) {
  const data = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  if (format === "ytjson") {
    return data.events.map((e) => ({
      start: e.tStartMs,
      end: e.tStartMs + e.dDurationMs,
      text: (e.segs ?? []).map((s) => s.utf8).join(""),
    }));
  }
  return data.map((c) => ({ start: c.start, end: c.end, text: c.text }));
}

/**
 * Read a CSV with a parser written against RFC 4180 rather than against subedit's writer, so a
 * quoting mistake in one is not repeated in the other.
 */
export function readCsv(path) {
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }

  const toMs = (v) => {
    const m = v.match(/(\d+):(\d{2}):(\d{2})[.,](\d{1,3})/);
    return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4].padEnd(3, "0");
  };
  return rows.slice(1).filter((r) => r.length >= 3).map((r) => ({ start: toMs(r[0]), end: toMs(r[1]), text: r[2] }));
}

/** The inverse of the bootstrap SRT writer, for reading an oracle's answer back. */
export function parseSrtBack(text) {
  const cues = [];
  for (const block of text.replace(/^﻿/, "").split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter((l, i) => !(i === 0 && /^\d+$/.test(l.trim())));
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const [a, b] = lines[at].split("-->");
    cues.push({ start: srtTimeBack(a), end: srtTimeBack(b), text: lines.slice(at + 1).join("\n").trimEnd() });
  }
  return cues;
}

function srtTimeBack(s) {
  const m = s.trim().match(/(\d+):(\d{2}):(\d{2})[.,](\d{1,3})/);
  if (!m) return NaN;
  return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4].padEnd(3, "0");
}

/**
 * Compare text ignoring the styling a format adds of its own accord.
 *
 * ffmpeg's ASS and TTML writers wrap runs in markup and their readers hand some of it back;
 * that is the format's business, not subedit's. Characters, spacing and line breaks are
 * compared strictly, which is where the hazards this corpus is built around actually live.
 */
export function normalizeText(s) {
  return s
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/\\N/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+$/gm, "");
}
