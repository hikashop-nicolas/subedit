// LRC timed lyrics: "[mm:ss.xx]text" per line, plus "[ar:]/[ti:]/[al:]" metadata. Each timed
// line carries only a start; the end is taken as the next line's start (the last line gets a
// short tail). Metadata and other bracket-tag header lines are preserved verbatim. End times
// are implicit in LRC, so a round-trip is faithful in text and starts but not in end times.

import { type Cue, type SubtitleDoc, detectEol, newCueId } from "./cue";

const TIME_RE = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const META_RE = /^\[[a-z#]+:.*\]$/i; // [ar:...], [ti:...], [offset:...], etc.
const TAIL_MS = 3000;

export function parseLrc(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const eol = detectEol(body);
  const finalNewline = /\r?\n$/.test(body);
  const lines = body.split(/\r?\n/);
  const meta: string[] = [];
  const stamped: { ms: number; text: string }[] = [];
  for (const line of lines) {
    if (META_RE.test(line.trim())) {
      meta.push(line);
      continue;
    }
    TIME_RE.lastIndex = 0;
    const times: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = TIME_RE.exec(line))) {
      const frac = m[3] ? parseInt(m[3].padEnd(3, "0").slice(0, 3), 10) : 0;
      times.push((parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 1000 + frac);
    }
    if (!times.length) continue;
    const text = line.replace(TIME_RE, "").trim();
    for (const ms of times) stamped.push({ ms, text }); // one line may repeat across timestamps
  }
  stamped.sort((a, b) => a.ms - b.ms);
  const cues: Cue[] = stamped.map((s, i) => ({
    id: newCueId(),
    startMs: s.ms,
    endMs: i + 1 < stamped.length ? stamped[i + 1].ms : s.ms + TAIL_MS,
    text: s.text,
  }));
  return { format: "lrc", cues, eol, bom, finalNewline, header: meta.length ? meta.join(eol) : undefined };
}

export function serializeLrc(doc: SubtitleDoc): string {
  const eol = doc.eol;
  const lines: string[] = [];
  if (doc.header) lines.push(...doc.header.split(/\r?\n/));
  for (const c of doc.cues) lines.push(`${lrcTime(c.startMs)}${c.text.replace(/\r?\n/g, " ")}`);
  let out = lines.join(eol);
  if (doc.finalNewline) out += eol;
  return (doc.bom ? "﻿" : "") + out;
}

function lrcTime(ms: number): string {
  const cs = Math.round(ms / 10); // centiseconds
  const mm = Math.floor(cs / 6000);
  const ss = Math.floor((cs % 6000) / 100);
  const cc = cs % 100;
  return `[${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cc).padStart(2, "0")}]`;
}
