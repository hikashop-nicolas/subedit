// TTML / DFXP (.ttml/.dfxp): the common timed-text caption profile used by broadcast and
// streaming. Parses "<p begin=.. end=..>text</p>" elements (times as clock "HH:MM:SS.mmm",
// an offset like "12.5s", or seconds), with "<br/>" as a line break. XML is not byte-
// preservable here, so serialize regenerates a clean, minimal TTML document. xml:lang is kept.

import { type Cue, type SubtitleDoc, detectEol, newCueId } from "./cue";

const P_RE = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;

export function parseTtml(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const eol = detectEol(body);
  const lang = body.match(/xml:lang\s*=\s*"([^"]*)"/i)?.[1] ?? "";
  const cues: Cue[] = [];
  let m: RegExpExecArray | null;
  P_RE.lastIndex = 0;
  while ((m = P_RE.exec(body))) {
    const begin = attrTime(m[1], "begin");
    if (begin == null) continue;
    const end = attrTime(m[1], "end");
    const text = unescapeXml(
      m[2]
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, ""),
    ).trim();
    cues.push({ id: newCueId(), startMs: begin, endMs: end ?? begin + 3000, text });
  }
  return { format: "ttml", cues, eol, bom, finalNewline: /\n$/.test(body), header: lang || undefined };
}

export function serializeTtml(doc: SubtitleDoc): string {
  const eol = doc.eol;
  const lang = doc.header ? ` xml:lang="${escapeXml(doc.header)}"` : "";
  const rows = doc.cues.map(
    (c) => `      <p begin="${ttmlTime(c.startMs)}" end="${ttmlTime(c.endMs)}">${escapeXml(c.text).replace(/\n/g, "<br/>")}</p>`,
  );
  const out = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<tt xmlns="http://www.w3.org/ns/ttml"${lang}>`,
    `  <body>`,
    `    <div>`,
    ...rows,
    `    </div>`,
    `  </body>`,
    `</tt>`,
  ].join(eol);
  return (doc.bom ? "﻿" : "") + out + (doc.finalNewline ? eol : "");
}

// begin/end may be a clock ("[HH:]MM:SS[.mmm]"), an offset ("12.5s"/"200ms"/"...f"), or bare
// seconds. Returns milliseconds, or null when the attribute is absent/unparseable.
function attrTime(attrs: string, name: string): number | null {
  const v = attrs.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1]?.trim();
  if (!v) return null;
  const off = v.match(/^([\d.]+)(ms|s|m|h)$/i);
  if (off) {
    const n = parseFloat(off[1]);
    const unit = off[2].toLowerCase();
    return Math.round(n * (unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60000 : 3600000));
  }
  const clock = v.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (clock) {
    const h = clock[1] ? parseInt(clock[1], 10) : 0;
    const frac = clock[4] ? parseInt(clock[4].padEnd(3, "0").slice(0, 3), 10) : 0;
    return ((h * 60 + parseInt(clock[2], 10)) * 60 + parseInt(clock[3], 10)) * 1000 + frac;
  }
  if (/^[\d.]+$/.test(v)) return Math.round(parseFloat(v) * 1000);
  return null;
}

function ttmlTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const mmm = total % 1000;
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(h)}:${p2(m)}:${p2(s)}.${String(mmm).padStart(3, "0")}`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
