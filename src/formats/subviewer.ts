// SubViewer 2.0 (.sub): an optional bracket-tag header ([INFORMATION]/[STYLE]/[COLF]/...) then
// blank-line-separated cues, each a "HH:MM:SS.cc,HH:MM:SS.cc" line (centiseconds) followed by
// text, with "[br]" as the line break. The header block is preserved verbatim.

import { type Cue, type SubtitleDoc, detectEol, newCueId } from "../cue";

const TIME_LINE = /^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,2}),(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,2})\s*$/;

function toMs(h: string, m: string, s: string, cc: string): number {
  return ((+h * 60 + +m) * 60 + +s) * 1000 + +cc.padEnd(2, "0").slice(0, 2) * 10;
}
function svTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const cc = Math.round((t % 1000) / 10);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(h)}:${p2(m)}:${p2(s)}.${p2(cc)}`;
}

export function parseSubViewer(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const eol = detectEol(body);
  const finalNewline = /\r?\n$/.test(body);
  const lines = body.split(/\r?\n/);
  // The header is everything before the first timing line (bracket tags, blank lines).
  let firstCue = lines.findIndex((l) => TIME_LINE.test(l));
  if (firstCue < 0) firstCue = lines.length;
  const header = lines.slice(0, firstCue).join(eol).replace(/\s+$/, "");
  const cues: Cue[] = [];
  for (let i = firstCue; i < lines.length; i += 1) {
    const m = lines[i].match(TIME_LINE);
    if (!m) continue;
    const startMs = toMs(m[1], m[2], m[3], m[4]);
    const endMs = toMs(m[5], m[6], m[7], m[8]);
    const text: string[] = [];
    i += 1;
    while (i < lines.length && lines[i].trim() !== "" && !TIME_LINE.test(lines[i])) {
      text.push(lines[i]);
      i += 1;
    }
    i -= 1;
    cues.push({ id: newCueId(), startMs, endMs, text: text.join("\n").replace(/\[br\]/gi, "\n") });
  }
  return { format: "subviewer", cues, eol, bom, finalNewline, header: header || undefined };
}

export function serializeSubViewer(doc: SubtitleDoc): string {
  const eol = doc.eol;
  const parts: string[] = [];
  if (doc.header) parts.push(doc.header);
  const blocks = doc.cues.map(
    (c) => `${svTime(c.startMs)},${svTime(c.endMs)}${eol}${c.text.replace(/\r?\n/g, "[br]")}`,
  );
  parts.push(blocks.join(eol + eol));
  let out = parts.join(eol + eol);
  if (doc.finalNewline) out += eol;
  return (doc.bom ? "﻿" : "") + out;
}
