// MicroDVD (.sub): one cue per line, "{startFrame}{endFrame}text". Lines are separated by
// '|', and {codes} for styling are kept verbatim in the text. Times are frame numbers,
// converted with the file's frame rate: a leading "{1}{1}<fps>" entry declares it, else a
// common default is assumed. A file whose fps round-trips (declared or not) is frame-exact.

import { type Cue, type SubtitleDoc, detectEol, newCueId } from "./cue";

const DEFAULT_FPS = 23.976;
const LINE_RE = /^\{(\d+)\}\{(\d+)\}(.*)$/;

export function parseMicroDvd(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const eol = detectEol(body);
  const finalNewline = /\r?\n$/.test(body);
  const lines = body.split(/\r?\n/);
  let fps: number | undefined;
  const cues: Cue[] = [];
  for (const line of lines) {
    const m = line.match(LINE_RE);
    if (!m) continue;
    const sf = parseInt(m[1], 10);
    const ef = parseInt(m[2], 10);
    const text = m[3];
    // Convention: "{1}{1}<fps>" declares the frame rate instead of being a cue.
    if (sf === 1 && ef === 1 && /^\d+(\.\d+)?$/.test(text.trim())) {
      const f = parseFloat(text.trim());
      if (f > 0) fps = f;
      continue;
    }
    const rate = fps ?? DEFAULT_FPS;
    cues.push({
      id: newCueId(),
      startMs: Math.round((sf / rate) * 1000),
      endMs: Math.round((ef / rate) * 1000),
      text: text.replace(/\|/g, "\n"),
    });
  }
  return { format: "sub", cues, eol, bom, finalNewline, fps };
}

export function serializeMicroDvd(doc: SubtitleDoc): string {
  const rate = doc.fps && doc.fps > 0 ? doc.fps : DEFAULT_FPS;
  const eol = doc.eol;
  const lines: string[] = [];
  // Re-emit the fps declaration only if the source had one, so files without it stay clean.
  if (doc.fps && doc.fps > 0) lines.push(`{1}{1}${doc.fps}`);
  for (const c of doc.cues) {
    const sf = Math.round((c.startMs / 1000) * rate);
    const ef = Math.round((c.endMs / 1000) * rate);
    lines.push(`{${sf}}{${ef}}${c.text.replace(/\r?\n/g, "|")}`);
  }
  let out = lines.join(eol);
  if (doc.finalNewline) out += eol;
  return (doc.bom ? "﻿" : "") + out;
}
