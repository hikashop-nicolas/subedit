// TMPlayer: one cue per line, "HH:MM:SS:text" (or "HH:MM:SS=text"), with '|' line breaks.
// Only a start time is stored; the end is taken as the next line's start (like LRC).

import { type Cue, type SubtitleDoc, detectEol, newCueId } from "../cue";

const LINE_RE = /^(\d{1,2}):(\d{2}):(\d{2})[:=](.*)$/;
const TAIL_MS = 2000;

export function parseTmp(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const eol = detectEol(body);
  const finalNewline = /\r?\n$/.test(body);
  const stamped: { ms: number; text: string }[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(LINE_RE);
    if (!m) continue;
    stamped.push({ ms: ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000, text: m[4].replace(/\|/g, "\n") });
  }
  const cues: Cue[] = stamped.map((s, i) => ({
    id: newCueId(),
    startMs: s.ms,
    endMs: i + 1 < stamped.length ? stamped[i + 1].ms : s.ms + TAIL_MS,
    text: s.text,
  }));
  return { format: "tmp", cues, eol, bom, finalNewline };
}

export function serializeTmp(doc: SubtitleDoc): string {
  const eol = doc.eol;
  const lines = doc.cues.map((c) => `${tmpTime(c.startMs)}:${c.text.replace(/\r?\n/g, "|")}`);
  let out = lines.join(eol);
  if (doc.finalNewline) out += eol;
  return (doc.bom ? "﻿" : "") + out;
}

function tmpTime(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000));
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(Math.floor(t / 3600))}:${p2(Math.floor((t % 3600) / 60))}:${p2(t % 60)}`;
}
