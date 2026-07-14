// QuickTime Text (.txt): a "{QTtext}..." header, then "[HH:MM:SS.hh]" time markers with the
// caption text between a marker and the next. Text shows from its marker until the following
// one; an empty span is a gap. {curly} style tags are stripped. Fractions are hundredths.

import { type Cue, type SubtitleDoc, detectEol, newCueId } from "../cue";

const STAMP_RE = /\[(\d{1,2}):(\d{2}):(\d{2})\.(\d{1,3})\]/;

export function parseQtText(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const eol = detectEol(body);
  const lines = body.split(/\r?\n/);
  const marks: { ms: number; text: string[] }[] = [];
  for (const line of lines) {
    const m = line.match(STAMP_RE);
    if (m) {
      const ms = ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4].padEnd(2, "0").slice(0, 2) * 10;
      marks.push({ ms, text: [] });
    } else if (marks.length) {
      const clean = line.replace(/\{[^}]*\}/g, "").trim();
      if (clean) marks[marks.length - 1].text.push(clean);
    }
  }
  const cues: Cue[] = [];
  for (let i = 0; i < marks.length; i += 1) {
    if (!marks[i].text.length) continue; // a gap / clear marker
    const end = marks[i + 1] ? marks[i + 1].ms : marks[i].ms + 3000;
    cues.push({ id: newCueId(), startMs: marks[i].ms, endMs: end, text: marks[i].text.join("\n") });
  }
  return { format: "qttext", cues, eol, bom, finalNewline: /\r?\n$/.test(body) };
}

function qtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `[${p2(Math.floor(t / 3600000))}:${p2(Math.floor((t % 3600000) / 60000))}:${p2(Math.floor((t % 60000) / 1000))}.${p2(Math.round((t % 1000) / 10))}]`;
}

export function serializeQtText(doc: SubtitleDoc): string {
  const eol = doc.eol;
  const parts = ["{QTtext}{timeScale:100}{width:320}{height:60}"];
  for (const c of doc.cues) {
    parts.push(qtTime(c.startMs));
    parts.push(c.text.replace(/\r?\n/g, eol));
    parts.push(qtTime(c.endMs));
    parts.push("");
  }
  let out = parts.join(eol);
  if (doc.finalNewline && !out.endsWith(eol)) out += eol;
  return (doc.bom ? "﻿" : "") + out;
}
