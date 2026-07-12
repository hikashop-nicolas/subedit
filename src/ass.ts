// Advanced SubStation Alpha (.ass) and SubStation Alpha (.ssa) parse / serialize.
//
// In-place philosophy: everything except the editable Dialogue lines is preserved
// verbatim, [Script Info], the styles section, [Fonts]/[Graphics], comments and blank
// lines, in their original order. Each Dialogue line becomes a cue; Comment lines and
// any other lines are kept as raw notes attached to the following cue (or the tail).
// Dialogue lines are rebuilt from their fields using the [Events] Format order, so an
// unedited canonical line round-trips identically.

import {
  type Cue,
  type SubtitleDoc,
  detectEol,
  formatAssTime,
  newCueId,
  parseTimestamp,
} from "./cue";

const DEFAULT_FORMAT = ["Layer", "Start", "End", "Style", "Name", "MarginL", "MarginR", "MarginV", "Effect", "Text"];

function isSectionHeader(line: string, name: RegExp): boolean {
  return name.test(line.trim());
}

// Split into at most n comma fields; the last field keeps every remaining comma (the
// ASS Text field can contain commas and is always last in the Format).
function splitFields(rest: string, n: number): string[] {
  const parts = rest.split(",");
  if (parts.length <= n) return parts;
  return [...parts.slice(0, n - 1), parts.slice(n - 1).join(",")];
}

export function parseAss(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const eol = detectEol(body);
  const finalNewline = /\r?\n$/.test(body);
  const lines = body.replace(/\r?\n$/, "").split(/\r?\n/);

  // Style names for the picker (from [V4+ Styles] / [V4 Styles]).
  const assStyles: string[] = [];
  let inStyles = false;
  for (const line of lines) {
    if (/^\[/.test(line.trim())) inStyles = /^\[v4\+? styles\]$/i.test(line.trim());
    else if (inStyles && /^Style\s*:/i.test(line)) {
      const name = line.replace(/^Style\s*:/i, "").split(",")[0]?.trim();
      if (name) assStyles.push(name);
    }
  }

  // Locate the [Events] section and its Format line; the header runs up to and
  // including that Format line.
  let inEvents = false;
  let formatIdx = -1;
  let assFormat = DEFAULT_FORMAT;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (/^\[/.test(trimmed)) inEvents = isSectionHeader(lines[i], /^\[events\]$/i);
    else if (inEvents && /^Format\s*:/i.test(lines[i])) {
      formatIdx = i;
      assFormat = lines[i]
        .replace(/^Format\s*:/i, "")
        .split(",")
        .map((s) => s.trim());
      break;
    }
  }

  if (formatIdx < 0) {
    // No Events/Format: keep the whole file as an inert header (read-only-ish).
    return { format: "ass", cues: [], eol, bom, finalNewline, header: lines.join(eol), assFormat, assStyles };
  }

  const header = lines.slice(0, formatIdx + 1).join(eol);
  const cues: Cue[] = [];
  let pending: string[] = [];
  const startI = assFormat.findIndex((f) => /^Start$/i.test(f));
  const endI = assFormat.findIndex((f) => /^End$/i.test(f));
  const textI = assFormat.findIndex((f) => /^Text$/i.test(f));

  for (let i = formatIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^Dialogue\s*:/i.test(line)) {
      const rest = line.replace(/^Dialogue\s*:\s?/i, "");
      const values = splitFields(rest, assFormat.length);
      const assFields: Record<string, string> = {};
      assFormat.forEach((name, j) => {
        if (j !== startI && j !== endI && j !== textI) assFields[name] = values[j] ?? "";
      });
      cues.push({
        id: newCueId(),
        startMs: startI >= 0 ? parseTimestamp(values[startI] ?? "") || 0 : 0,
        endMs: endI >= 0 ? parseTimestamp(values[endI] ?? "") || 0 : 0,
        text: textI >= 0 ? values[textI] ?? "" : "",
        assFields,
        notesBefore: pending.length ? pending.join(eol) : undefined,
      });
      pending = [];
    } else {
      pending.push(line); // Comment:, ; comment, blank, [Fonts], font data, ...
    }
  }

  return {
    format: "ass",
    cues,
    eol,
    bom,
    finalNewline,
    header,
    trailingNotes: pending.length ? pending.join(eol) : undefined,
    assFormat,
    assStyles,
  };
}

function serializeDialogue(cue: Cue, format: string[]): string {
  const fields = format.map((name) => {
    if (/^Start$/i.test(name)) return formatAssTime(cue.startMs);
    if (/^End$/i.test(name)) return formatAssTime(cue.endMs);
    if (/^Text$/i.test(name)) return cue.text;
    return cue.assFields?.[name] ?? "";
  });
  return `Dialogue: ${fields.join(",")}`;
}

export function serializeAss(doc: SubtitleDoc): string {
  const eol = doc.eol;
  const format = doc.assFormat ?? DEFAULT_FORMAT;
  const chunks: string[] = [doc.header ?? ""];
  for (const cue of doc.cues) {
    if (cue.notesBefore) chunks.push(cue.notesBefore);
    chunks.push(serializeDialogue(cue, format));
  }
  if (doc.trailingNotes) chunks.push(doc.trailingNotes);
  let out = chunks.join(eol);
  if (doc.finalNewline) out += eol;
  return (doc.bom ? "\uFEFF" : "") + out;
}

// A minimal ASS scaffold used when converting SRT/VTT to ASS.
export function defaultAssHeader(eol: string): string {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1920",
    "PlayResY: 1080",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Arial,72,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,30,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join(eol);
}

export const ASS_EVENT_FORMAT = DEFAULT_FORMAT;
