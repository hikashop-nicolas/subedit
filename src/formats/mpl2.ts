// MPL2: one cue per line, "[start][end]text", where start/end are deciseconds (tenths of a
// second) and '|' separates lines. Time-based (unlike MicroDVD's frames), so decisecond-exact.

import { type Cue, type SubtitleDoc, detectEol, newCueId } from "../cue";

const LINE_RE = /^\[(\d+)\]\[(\d+)\](.*)$/;

export function parseMpl2(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const eol = detectEol(body);
  const finalNewline = /\r?\n$/.test(body);
  const cues: Cue[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(LINE_RE);
    if (!m) continue;
    cues.push({
      id: newCueId(),
      startMs: parseInt(m[1], 10) * 100,
      endMs: parseInt(m[2], 10) * 100,
      text: m[3].replace(/\|/g, "\n"),
    });
  }
  return { format: "mpl2", cues, eol, bom, finalNewline };
}

export function serializeMpl2(doc: SubtitleDoc): string {
  const eol = doc.eol;
  const lines = doc.cues.map(
    (c) => `[${Math.round(c.startMs / 100)}][${Math.round(c.endMs / 100)}]${c.text.replace(/\r?\n/g, "|")}`,
  );
  let out = lines.join(eol);
  if (doc.finalNewline) out += eol;
  return (doc.bom ? "﻿" : "") + out;
}
