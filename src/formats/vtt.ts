// WebVTT (.vtt) parse / serialize. The file starts with a "WEBVTT" header block, then
// blocks separated by blank lines: cues, or NOTE / STYLE / REGION metadata blocks.
// Metadata blocks are preserved verbatim and attached to the following cue (or the doc
// tail) so they survive editing. Timestamps are normalized to "HH:MM:SS.mmm" on write.

import {
  type Cue,
  type SubtitleDoc,
  detectEol,
  formatTimestamp,
  newCueId,
  parseTimestamp,
} from "../cue";

const ARROW = "-->";

function isMetaBlock(block: string): boolean {
  return /^(NOTE|STYLE|REGION)(\s|$)/.test(block);
}

export function parseVtt(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const eol = detectEol(body);
  const finalNewline = /\r?\n$/.test(body);

  // Split on blank-line boundaries. A cue's own text never contains a blank line, and
  // NOTE/STYLE/REGION blocks likewise end at the first blank line.
  const normalized = body.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  const blocks = normalized.split(/\n{2,}/);

  const header = blocks.length ? blocks[0] : "WEBVTT";
  const cues: Cue[] = [];
  let pendingNotes: string[] = [];

  for (let b = 1; b < blocks.length; b += 1) {
    const block = blocks[b];
    if (block.trim() === "") continue;
    if (isMetaBlock(block)) {
      pendingNotes.push(block);
      continue;
    }
    // Cue block: optional identifier line, then a timing line, then text.
    const lines = block.split("\n");
    let idx = 0;
    let identifier: string | undefined;
    if (!lines[0].includes(ARROW)) {
      identifier = lines[0];
      idx = 1;
    }
    const timing = lines[idx] ?? "";
    if (!timing.includes(ARROW)) {
      // Not a real cue; keep the whole block as a note so nothing is lost.
      pendingNotes.push(block);
      continue;
    }
    const [left, right] = timing.split(ARROW);
    const startMs = parseTimestamp(left);
    const rest = (right ?? "").trim();
    const endToken = rest.split(/\s+/)[0] ?? "";
    const endMs = parseTimestamp(endToken);
    const settings = rest.slice(endToken.length).trim();
    const text = lines.slice(idx + 1).join("\n");

    cues.push({
      id: newCueId(),
      startMs: Number.isNaN(startMs) ? 0 : startMs,
      endMs: Number.isNaN(endMs) ? 0 : endMs,
      text,
      identifier,
      settings: settings || undefined,
      notesBefore: pendingNotes.length ? pendingNotes.join("\n\n") : undefined,
    });
    pendingNotes = [];
  }

  return {
    format: "vtt",
    cues,
    eol,
    bom,
    finalNewline,
    header,
    trailingNotes: pendingNotes.length ? pendingNotes.join("\n\n") : undefined,
  };
}

export function serializeVtt(doc: SubtitleDoc): string {
  const { eol } = doc;
  const chunks: string[] = [doc.header ?? "WEBVTT"];

  for (const cue of doc.cues) {
    if (cue.notesBefore) chunks.push(cue.notesBefore);
    const timing =
      `${formatTimestamp(cue.startMs, ".")} ${ARROW} ${formatTimestamp(cue.endMs, ".")}` +
      (cue.settings ? ` ${cue.settings}` : "");
    const head = cue.identifier ? `${cue.identifier}\n${timing}` : timing;
    chunks.push(cue.text ? `${head}\n${cue.text}` : head);
  }
  if (doc.trailingNotes) chunks.push(doc.trailingNotes);

  let out = chunks.join("\n\n").replace(/\n/g, eol);
  if (doc.finalNewline) out += eol;
  return (doc.bom ? "\uFEFF" : "") + out;
}
