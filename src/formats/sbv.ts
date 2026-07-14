// SBV (YouTube SubViewer): blank-line-separated cues, each a "H:MM:SS.mmm,H:MM:SS.mmm"
// timing line followed by the text lines. A well-formed file round-trips exactly.

import { type Cue, type SubtitleDoc, detectEol, newCueId } from "../cue";

function sbvTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const mmm = t % 1000;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(mmm).padStart(3, "0")}`;
}
function parseSbvTime(v: string): number {
  const m = v.trim().match(/^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) return NaN;
  return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4].padEnd(3, "0").slice(0, 3);
}

export function parseSbv(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const eol = detectEol(body);
  const finalNewline = /\r?\n$/.test(body);
  const cues: Cue[] = [];
  for (const block of body.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    while (lines.length && lines[0].trim() === "") lines.shift();
    if (!lines.length) continue;
    const [a, b] = lines[0].split(",");
    const startMs = parseSbvTime(a ?? "");
    const endMs = parseSbvTime(b ?? "");
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
    cues.push({ id: newCueId(), startMs, endMs, text: lines.slice(1).join("\n") });
  }
  return { format: "sbv", cues, eol, bom, finalNewline };
}

export function serializeSbv(doc: SubtitleDoc): string {
  const eol = doc.eol;
  const blocks = doc.cues.map((c) => `${sbvTime(c.startMs)},${sbvTime(c.endMs)}${eol}${c.text.replace(/\r?\n/g, eol)}`);
  let out = blocks.join(eol + eol);
  if (doc.finalNewline) out += eol;
  return (doc.bom ? "﻿" : "") + out;
}
