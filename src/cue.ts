// The cue model shared by every subtitle format, plus timestamp helpers.
//
// A SubtitleDoc keeps enough trivia (line-ending flavor, BOM, VTT header and
// NOTE/STYLE/REGION blocks, cue identifiers and settings) that a well-formed file
// round-trips byte-for-byte. Edited cues are re-serialized in canonical form.

export type SubtitleFormat = "srt" | "vtt";

export interface Cue {
  // Ephemeral id for the UI (list keys, selection). NOT persisted to the file.
  id: string;
  startMs: number;
  endMs: number;
  // Cue text; embedded newlines separate displayed lines. Inline markup
  // (<i>, {\an8}, ...) is kept verbatim in v1, no WYSIWYG.
  text: string;
  // VTT optional identifier line preceding the timings (or undefined).
  identifier?: string;
  // Trailing tokens after the timestamps: VTT cue settings, or SRT position coords.
  settings?: string;
  // Raw NOTE/STYLE/REGION block(s) that immediately precede this cue, verbatim,
  // so VTT metadata travels with its following cue across edits.
  notesBefore?: string;
}

export interface SubtitleDoc {
  format: SubtitleFormat;
  cues: Cue[];
  eol: "\n" | "\r\n";
  bom: boolean;
  finalNewline: boolean;
  // VTT: the "WEBVTT..." preamble up to the first blank line, verbatim. SRT: undefined.
  header?: string;
  // Raw blocks after the last cue (VTT NOTE/STYLE), verbatim.
  trailingNotes?: string;
}

let idSeq = 0;
export function newCueId(): string {
  idSeq += 1;
  return `c${idSeq}`;
}

// A blank cue at the given start, one second long, for "insert cue".
export function blankCue(startMs: number, endMs = startMs + 1000, text = ""): Cue {
  return { id: newCueId(), startMs, endMs, text };
}

// Detect the dominant line ending: CRLF if the file uses it anywhere, else LF.
export function detectEol(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

// Parse "HH:MM:SS,mmm" (SRT) or "HH:MM:SS.mmm" / "MM:SS.mmm" (VTT) to milliseconds.
// Accepts either separator so lenient reading works across formats. NaN on garbage.
export function parseTimestamp(s: string): number {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/);
  if (!m) return NaN;
  const hours = m[1] ? parseInt(m[1], 10) : 0;
  const minutes = parseInt(m[2], 10);
  const seconds = parseInt(m[3], 10);
  const millis = parseInt(m[4].padEnd(3, "0"), 10);
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

// Format milliseconds as "HH:MM:SS<sep>mmm" (sep "," for SRT, "." for VTT).
export function formatTimestamp(ms: number, sep: "," | "." = ","): string {
  const clamped = Math.max(0, Math.round(ms));
  const millis = clamped % 1000;
  const totalSeconds = (clamped - millis) / 1000;
  const seconds = totalSeconds % 60;
  const totalMinutes = (totalSeconds - seconds) / 60;
  const minutes = totalMinutes % 60;
  const hours = (totalMinutes - minutes) / 60;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(hours)}:${p(minutes)}:${p(seconds)}${sep}${p(millis, 3)}`;
}

// Visible-character count (markup and newlines removed), used for CPS / line-length.
export function visibleText(text: string): string {
  return text
    .replace(/<[^>]*>/g, "") // <i>, <b>, <c.class>, ...
    .replace(/\{[^}]*\}/g, "") // ASS-style override tags if present
    .replace(/\s+/g, " ")
    .trim();
}

// Characters per second over the cue's on-screen duration (0 if zero-length).
export function cps(cue: Cue): number {
  const durationSec = (cue.endMs - cue.startMs) / 1000;
  if (durationSec <= 0) return 0;
  return visibleText(cue.text).length / durationSec;
}

export function sortCues(cues: Cue[]): Cue[] {
  return [...cues].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}
