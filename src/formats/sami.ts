// SAMI (.smi): Microsoft's HTML-ish caption format. Captions are "<SYNC Start=ms>" markers,
// each showing its "<P>" text until the next SYNC; a SYNC whose text is empty or "&nbsp;"
// clears the caption (marking the previous one's end). XML/HTML isn't byte-preservable, so
// serialize regenerates a clean minimal SAMI document.

import { type Cue, type SubtitleDoc, detectEol, newCueId } from "../cue";

const SYNC_RE = /<sync\b[^>]*\bstart\s*=\s*["']?(\d+)["']?[^>]*>([\s\S]*?)(?=<sync\b|<\/body>|$)/gi;

function textFrom(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function parseSami(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const eol = detectEol(body);
  const lang = body.match(/<p\b[^>]*\bclass\s*=\s*["']?([a-z]{2}cc)/i)?.[1];
  const marks: { start: number; text: string }[] = [];
  let m: RegExpExecArray | null;
  SYNC_RE.lastIndex = 0;
  while ((m = SYNC_RE.exec(body))) marks.push({ start: +m[1], text: textFrom(m[2]) });
  const cues: Cue[] = [];
  for (let i = 0; i < marks.length; i += 1) {
    if (!marks[i].text) continue; // a clear marker
    const end = marks[i + 1] ? marks[i + 1].start : marks[i].start + 3000;
    cues.push({ id: newCueId(), startMs: marks[i].start, endMs: end, text: marks[i].text });
  }
  return { format: "sami", cues, eol, bom, finalNewline: /\n$/.test(body), header: lang || undefined };
}

export function serializeSami(doc: SubtitleDoc): string {
  const eol = doc.eol;
  const cls = doc.header || "ENCC";
  const rows: string[] = [];
  for (const c of doc.cues) {
    rows.push(`<SYNC Start=${Math.round(c.startMs)}><P Class=${cls}>${esc(c.text).replace(/\n/g, "<br>")}`);
    rows.push(`<SYNC Start=${Math.round(c.endMs)}><P Class=${cls}>&nbsp;`);
  }
  const out = [
    "<SAMI>",
    "<HEAD>",
    `<STYLE TYPE="text/css"><!-- P { font-family: sans-serif; color: white; } --></STYLE>`,
    "</HEAD>",
    "<BODY>",
    ...rows,
    "</BODY>",
    "</SAMI>",
  ].join(eol);
  return (doc.bom ? "﻿" : "") + out + (doc.finalNewline ? eol : "");
}
