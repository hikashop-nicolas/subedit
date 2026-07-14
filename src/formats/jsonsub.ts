// Generic JSON subtitles: an array of { start, end, text } objects (times in milliseconds).
// Lenient on read (accepts start/startMs/from and end/endMs/to). Distinct from the YouTube
// json3 format, which has an { events: [...] } shape with tStartMs.

import { type Cue, type SubtitleDoc, newCueId } from "../cue";

interface Row {
  start?: number;
  startMs?: number;
  from?: number;
  end?: number;
  endMs?: number;
  to?: number;
  text?: string;
}

export function parseJsonSubs(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  let rows: Row[] = [];
  try {
    const parsed = JSON.parse(body);
    rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.cues) ? parsed.cues : [];
  } catch {
    rows = [];
  }
  const num = (...v: (number | undefined)[]) => v.find((x) => typeof x === "number") ?? 0;
  const cues: Cue[] = rows.map((r) => ({
    id: newCueId(),
    startMs: Math.round(num(r.start, r.startMs, r.from)),
    endMs: Math.round(num(r.end, r.endMs, r.to)),
    text: typeof r.text === "string" ? r.text : "",
  }));
  return { format: "jsonsub", cues, eol: "\n", bom, finalNewline: /\n$/.test(body) };
}

export function serializeJsonSubs(doc: SubtitleDoc): string {
  const rows = doc.cues.map((c) => ({ start: Math.round(c.startMs), end: Math.round(c.endMs), text: c.text }));
  return (doc.bom ? "﻿" : "") + JSON.stringify(rows, null, 2) + (doc.finalNewline ? "\n" : "");
}
