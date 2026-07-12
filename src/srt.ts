// SubRip (.srt) parse / serialize. Cues are separated by blank lines; each cue is an
// optional integer index, a "start --> end" line, then one or more text lines.
// Indices are renumbered 1..N on write, so a sequentially-numbered file round-trips.

import {
  type Cue,
  type SubtitleDoc,
  detectEol,
  formatTimestamp,
  newCueId,
  parseTimestamp,
} from "./cue";

const ARROW = "-->";

export function parseSrt(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const eol = detectEol(body);
  const finalNewline = /\r?\n$/.test(body);

  const lines = body.split(/\r?\n/);
  const cues: Cue[] = [];
  let i = 0;
  while (i < lines.length) {
    // Skip blank separators.
    if (lines[i].trim() === "") {
      i += 1;
      continue;
    }
    // Optional index line.
    if (/^\d+$/.test(lines[i].trim()) && lines[i + 1]?.includes(ARROW)) {
      i += 1;
    }
    const timing = lines[i];
    if (!timing || !timing.includes(ARROW)) {
      // Not a cue we understand; skip to the next blank line.
      while (i < lines.length && lines[i].trim() !== "") i += 1;
      continue;
    }
    i += 1;
    const [left, right] = timing.split(ARROW);
    const startMs = parseTimestamp(left);
    // The end timestamp may be followed by SRT position coords; keep them as settings.
    const rest = (right ?? "").trim();
    const endToken = rest.split(/\s+/)[0] ?? "";
    const endMs = parseTimestamp(endToken);
    const settings = rest.slice(endToken.length).trim();

    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      textLines.push(lines[i]);
      i += 1;
    }
    cues.push({
      id: newCueId(),
      startMs: Number.isNaN(startMs) ? 0 : startMs,
      endMs: Number.isNaN(endMs) ? 0 : endMs,
      text: textLines.join("\n"),
      settings: settings || undefined,
    });
  }

  return { format: "srt", cues, eol, bom, finalNewline };
}

export function serializeSrt(doc: SubtitleDoc): string {
  const { eol } = doc;
  const blocks = doc.cues.map((cue, idx) => {
    const timing =
      `${formatTimestamp(cue.startMs, ",")} ${ARROW} ${formatTimestamp(cue.endMs, ",")}` +
      (cue.settings ? ` ${cue.settings}` : "");
    const text = cue.text.replace(/\r?\n/g, eol);
    return `${idx + 1}${eol}${timing}${eol}${text}`;
  });
  let out = blocks.join(eol + eol);
  if (doc.finalNewline) out += eol;
  return (doc.bom ? "\uFEFF" : "") + out;
}
