// DVD Studio Pro STL: "HH:MM:SS:FF , HH:MM:SS:FF , text" per line (note the spaces around the
// commas), frame-based, with '|' line breaks. Frames convert with the file's fps (a leading
// "$FPS = n" line or a default). "//" and "$..." lines are kept verbatim as a header.

import { type Cue, type SubtitleDoc, detectEol, newCueId } from "../cue";

const DEFAULT_FPS = 25;
const LINE_RE = /^(\d{2}):(\d{2}):(\d{2}):(\d{2})\s*,\s*(\d{2}):(\d{2}):(\d{2}):(\d{2})\s*,\s*(.*)$/;

function tcToMs(h: string, m: string, s: string, f: string, fps: number): number {
  return ((+h * 60 + +m) * 60 + +s) * 1000 + Math.round((+f / fps) * 1000);
}
function msToTc(ms: number, fps: number): string {
  const t = Math.max(0, Math.round(ms));
  const f = Math.min(fps - 1, Math.round(((t % 1000) / 1000) * fps));
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(Math.floor(t / 3600000))}:${p2(Math.floor((t % 3600000) / 60000))}:${p2(Math.floor((t % 60000) / 1000))}:${p2(f)}`;
}

export function parseDvdStudio(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const eol = detectEol(body);
  const finalNewline = /\r?\n$/.test(body);
  const fps = parseFloat(body.match(/\$FPS\s*=\s*([\d.]+)/i)?.[1] ?? "") || DEFAULT_FPS;
  const header: string[] = [];
  const cues: Cue[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(LINE_RE);
    if (!m) {
      if (line.trim().startsWith("$") || line.trim().startsWith("//")) header.push(line);
      continue;
    }
    cues.push({
      id: newCueId(),
      startMs: tcToMs(m[1], m[2], m[3], m[4], fps),
      endMs: tcToMs(m[5], m[6], m[7], m[8], fps),
      text: m[9].replace(/\|/g, "\n"),
    });
  }
  return { format: "dvdsp", cues, eol, bom, finalNewline, header: header.length ? header.join(eol) : undefined, fps };
}

export function serializeDvdStudio(doc: SubtitleDoc): string {
  const eol = doc.eol;
  const fps = doc.fps && doc.fps > 0 ? doc.fps : DEFAULT_FPS;
  const parts: string[] = [];
  if (doc.header) parts.push(doc.header);
  for (const c of doc.cues) {
    parts.push(`${msToTc(c.startMs, fps)} , ${msToTc(c.endMs, fps)} , ${c.text.replace(/\r?\n/g, "|")}`);
  }
  let out = parts.join(eol);
  if (doc.finalNewline) out += eol;
  return (doc.bom ? "﻿" : "") + out;
}
