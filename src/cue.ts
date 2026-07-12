// The cue model shared by every subtitle format, plus timestamp helpers.
//
// A SubtitleDoc keeps enough trivia (line-ending flavor, BOM, VTT header and
// NOTE/STYLE/REGION blocks, cue identifiers and settings) that a well-formed file
// round-trips byte-for-byte. Edited cues are re-serialized in canonical form.

export type SubtitleFormat = "srt" | "vtt" | "ass";

export interface Cue {
  // Ephemeral id for the UI (list keys, selection). NOT persisted to the file.
  id: string;
  startMs: number;
  endMs: number;
  // Cue text; for SRT/VTT embedded newlines separate lines. For ASS this is the raw
  // Text field (with \N breaks and {\...} override tags), kept verbatim (no WYSIWYG).
  text: string;
  // VTT optional identifier line preceding the timings (or undefined).
  identifier?: string;
  // Trailing tokens after the timestamps: VTT cue settings, or SRT position coords.
  settings?: string;
  // Raw NOTE/STYLE/REGION (VTT) or Comment/;/font (ASS) block(s) immediately preceding
  // this cue, verbatim, so metadata travels with its following cue across edits.
  notesBefore?: string;
  // ASS event kind (always "Dialogue" for editable cues; "Comment" lines are kept as
  // notes) and the non-time/text Event fields keyed by their Format name (Layer, Style,
  // Name, MarginL/R/V, Effect, ...), preserved and re-emitted in the file's field order.
  assFields?: Record<string, string>;
}

// An ASS style definition ([V4+ Styles] Style line), editable in the styles editor.
export interface AssStyle {
  name: string;
  // The Style Format fields except Name (Fontname, Fontsize, PrimaryColour, Bold, ...),
  // keyed by their Format name and re-emitted in the file's field order.
  fields: Record<string, string>;
  // Raw non-Style lines within the styles section preceding this style, verbatim.
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
  // Raw blocks after the last cue (VTT NOTE/STYLE, ASS trailing), verbatim.
  trailingNotes?: string;
  // ASS layout: verbatim text from the start through the [V4+ Styles] Format line;
  // editable style definitions; verbatim text after the last Style line through the
  // [Events] Format line; and the Style / Events Format field names in order.
  assScriptInfo?: string;
  styles?: AssStyle[];
  assStylesTail?: string;
  assStyleFormat?: string[];
  assFormat?: string[];
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
    .replace(/\\[Nnh]/g, " ") // ASS line breaks (\N, \n) and hard space (\h)
    .replace(/\s+/g, " ")
    .trim();
}

// ASS timestamp: "H:MM:SS.cc" (1-digit hour, centisecond precision).
export function formatAssTime(ms: number): string {
  const totalCs = Math.round(Math.max(0, ms) / 10); // whole value in centiseconds
  const cs = totalCs % 100;
  const totalSeconds = Math.floor(totalCs / 100);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${h}:${p(m)}:${p(s)}.${p(cs)}`;
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
