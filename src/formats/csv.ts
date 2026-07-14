// CSV subtitles: a header row then one row per cue. On read, the Start/End/Text columns are
// found by header name (case-insensitive), times parsed as HH:MM:SS[.,]mmm, seconds, or ms.
// On write, a "Start,End,Text" file with HH:MM:SS,mmm times and RFC-4180 quoting.

import { type Cue, type SubtitleDoc, detectEol, formatTimestamp, newCueId, parseTimestamp } from "../cue";

// Split CSV text into records of fields, honouring quoted fields with "" escapes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function timeToMs(v: string): number {
  const s = v.trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10); // bare milliseconds
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 1000); // seconds
  const ms = parseTimestamp(s);
  return Number.isNaN(ms) ? 0 : ms;
}

export function parseCsvSubs(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const eol = detectEol(body);
  const rows = parseCsv(body).filter((r) => r.length && r.some((f) => f.trim() !== ""));
  const cues: Cue[] = [];
  if (rows.length) {
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const find = (...names: string[]) => head.findIndex((h) => names.includes(h));
    let si = find("start", "show", "in", "begin", "start time");
    let ei = find("end", "hide", "out", "stop", "end time");
    let ti = find("text", "caption", "subtitle", "content");
    const hasHeader = si >= 0 || ei >= 0 || ti >= 0;
    if (!hasHeader) {
      si = 0;
      ei = 1;
      ti = 2;
    } // no header: assume start,end,text
    for (const r of rows.slice(hasHeader ? 1 : 0)) {
      const startMs = timeToMs(r[si] ?? "");
      const endMs = timeToMs(r[ei] ?? "");
      const text = (ti >= 0 ? r[ti] : r.slice(2).join(", ")) ?? "";
      cues.push({ id: newCueId(), startMs, endMs, text });
    }
  }
  return { format: "csv", cues, eol, bom, finalNewline: /\r?\n$/.test(body) };
}

function q(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function serializeCsvSubs(doc: SubtitleDoc): string {
  const eol = doc.eol;
  const lines = ["Start,End,Text"];
  // Use a dot for the millisecond separator so the timestamp itself contains no comma and
  // stays a single CSV field without quoting.
  for (const c of doc.cues) {
    lines.push(`${formatTimestamp(c.startMs, ".")},${formatTimestamp(c.endMs, ".")},${q(c.text)}`);
  }
  let out = lines.join(eol);
  if (doc.finalNewline) out += eol;
  return (doc.bom ? "﻿" : "") + out;
}
