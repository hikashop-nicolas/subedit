// Spruce STL (.stl, the text variant): "HH:MM:SS:FF,HH:MM:SS:FF,text" lines with '|' line
// breaks, and optional "$Key = Value" config / "//" comment lines kept verbatim as a header.
// Timecodes carry frames, converted with the file's fps (declared via "$FPS", else a default).

import { type Cue, type SubtitleDoc, detectEol, newCueId } from "../cue";

const DEFAULT_FPS = 25;
const LINE_RE = /^(\d{2}):(\d{2}):(\d{2}):(\d{2}),(\d{2}):(\d{2}):(\d{2}):(\d{2}),(.*)$/;

function tcToMs(h: string, m: string, s: string, f: string, fps: number): number {
  return ((+h * 60 + +m) * 60 + +s) * 1000 + Math.round((+f / fps) * 1000);
}
function msToTc(ms: number, fps: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const f = Math.min(fps - 1, Math.round(((t % 1000) / 1000) * fps));
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(h)}:${p2(m)}:${p2(s)}:${p2(f)}`;
}

export function parseSpruce(raw: string): SubtitleDoc {
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
  return { format: "spruce", cues, eol, bom, finalNewline, header: header.length ? header.join(eol) : undefined, fps };
}

export function serializeSpruce(doc: SubtitleDoc): string {
  const eol = doc.eol;
  const fps = doc.fps && doc.fps > 0 ? doc.fps : DEFAULT_FPS;
  const parts: string[] = [];
  if (doc.header) parts.push(doc.header);
  for (const c of doc.cues) {
    parts.push(`${msToTc(c.startMs, fps)},${msToTc(c.endMs, fps)},${c.text.replace(/\r?\n/g, "|")}`);
  }
  let out = parts.join(eol);
  if (doc.finalNewline) out += eol;
  return (doc.bom ? "﻿" : "") + out;
}
