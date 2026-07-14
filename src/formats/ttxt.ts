// TTXT (3GPP / MPEG-4 Timed Text, .ttxt): an XML <TextStream> of <TextSample sampleTime=..>
// markers. A sample's text shows from its sampleTime until the next sample; an empty sample
// clears it. Serialize regenerates a minimal TTXT document (XML isn't byte-preservable).

import { type Cue, type SubtitleDoc, detectEol, newCueId } from "../cue";

const SAMPLE_RE = /<TextSample\b([^>]*?)(?:\/>|>([\s\S]*?)<\/TextSample>)/gi;

function sampleTimeMs(v: string): number | null {
  const m = v.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) return null;
  const h = m[1] ? +m[1] : 0;
  return ((h * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4].padEnd(3, "0").slice(0, 3);
}
function unesc(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function parseTtxt(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const eol = detectEol(body);
  const marks: { ms: number; text: string }[] = [];
  let m: RegExpExecArray | null;
  SAMPLE_RE.lastIndex = 0;
  while ((m = SAMPLE_RE.exec(body))) {
    const t = m[1].match(/sampleTime\s*=\s*"([^"]*)"/i)?.[1];
    const ms = t ? sampleTimeMs(t) : null;
    if (ms == null) continue;
    const attrText = m[1].match(/\btext\s*=\s*"([^"]*)"/i)?.[1];
    const text = unesc(attrText ?? m[2] ?? "").trim();
    marks.push({ ms, text });
  }
  const cues: Cue[] = [];
  for (let i = 0; i < marks.length; i += 1) {
    if (!marks[i].text) continue;
    const end = marks[i + 1] ? marks[i + 1].ms : marks[i].ms + 3000;
    cues.push({ id: newCueId(), startMs: marks[i].ms, endMs: end, text: marks[i].text });
  }
  return { format: "ttxt", cues, eol, bom, finalNewline: /\n$/.test(body) };
}

function tc(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(Math.floor(t / 3600000))}:${p2(Math.floor((t % 3600000) / 60000))}:${p2(Math.floor((t % 60000) / 1000))}.${String(t % 1000).padStart(3, "0")}`;
}

export function serializeTtxt(doc: SubtitleDoc): string {
  const eol = doc.eol;
  const rows: string[] = [];
  for (const c of doc.cues) {
    rows.push(`<TextSample sampleTime="${tc(c.startMs)}" text="${esc(c.text).replace(/\n/g, "&#10;")}"/>`);
    rows.push(`<TextSample sampleTime="${tc(c.endMs)}" text=""/>`);
  }
  const out = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<TextStream version="1.1">`,
    `<TextStreamHeader><TextSampleDescription/></TextStreamHeader>`,
    ...rows,
    `</TextStream>`,
  ].join(eol);
  return (doc.bom ? "﻿" : "") + out + (doc.finalNewline ? eol : "");
}
