// YouTube JSON captions (json3 / srv3): a { "events": [...] } document where each caption
// event has tStartMs, dDurationMs and segs (text runs with a "utf8" field). Non-caption
// events (window/pen definitions) are ignored. Serialize regenerates a minimal json3 doc.

import { type Cue, type SubtitleDoc, newCueId } from "../cue";

interface Seg {
  utf8?: string;
}
interface Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Seg[];
}

export function parseYtJson(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  let events: Event[] = [];
  try {
    events = (JSON.parse(body) as { events?: Event[] }).events ?? [];
  } catch {
    events = [];
  }
  const cues: Cue[] = [];
  for (const e of events) {
    if (typeof e.tStartMs !== "number" || !e.segs) continue;
    const text = e.segs
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\r/g, "");
    if (!text.trim() && !e.dDurationMs) continue; // spacer/newline-only event
    cues.push({ id: newCueId(), startMs: e.tStartMs, endMs: e.tStartMs + (e.dDurationMs ?? 3000), text });
  }
  return { format: "ytjson", cues, eol: "\n", bom, finalNewline: /\n$/.test(body) };
}

export function serializeYtJson(doc: SubtitleDoc): string {
  const events = doc.cues.map((c) => ({
    tStartMs: Math.round(c.startMs),
    dDurationMs: Math.max(0, Math.round(c.endMs - c.startMs)),
    segs: [{ utf8: c.text }],
  }));
  const out = JSON.stringify({ events }, null, 2);
  return (doc.bom ? "﻿" : "") + out + (doc.finalNewline ? "\n" : "");
}
