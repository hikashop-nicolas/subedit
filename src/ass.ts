// Advanced SubStation Alpha (.ass) and SubStation Alpha (.ssa) parse / serialize.
//
// In-place philosophy: [Script Info], [Fonts]/[Graphics], comments and blank lines are
// preserved verbatim in order. The [V4+ Styles] Style lines and the [Events] Dialogue
// lines are parsed into editable structures and rebuilt from their fields using the
// section's own Format order, so an unedited canonical line round-trips identically.
// The document is split into: assScriptInfo (start through the Styles Format line),
// styles (editable), assStylesTail (after the last Style line through the Events Format
// line, e.g. blank lines / [Fonts] / the [Events] header), then the event cues.

import {
  type AssStyle,
  type Cue,
  type SubtitleDoc,
  detectEol,
  formatAssTime,
  newCueId,
  parseTimestamp,
} from "./cue";

const DEFAULT_EVENT_FORMAT = ["Layer", "Start", "End", "Style", "Name", "MarginL", "MarginR", "MarginV", "Effect", "Text"];
export const DEFAULT_STYLE_FORMAT = [
  "Name", "Fontname", "Fontsize", "PrimaryColour", "SecondaryColour", "OutlineColour", "BackColour",
  "Bold", "Italic", "Underline", "StrikeOut", "ScaleX", "ScaleY", "Spacing", "Angle", "BorderStyle",
  "Outline", "Shadow", "Alignment", "MarginL", "MarginR", "MarginV", "Encoding",
];
const DEFAULT_STYLE_VALUES: Record<string, string> = {
  Fontname: "Arial", Fontsize: "72", PrimaryColour: "&H00FFFFFF", SecondaryColour: "&H000000FF",
  OutlineColour: "&H00000000", BackColour: "&H00000000", Bold: "0", Italic: "0", Underline: "0",
  StrikeOut: "0", ScaleX: "100", ScaleY: "100", Spacing: "0", Angle: "0", BorderStyle: "1",
  Outline: "2", Shadow: "2", Alignment: "2", MarginL: "10", MarginR: "10", MarginV: "30", Encoding: "1",
};

export function makeDefaultStyle(name: string): AssStyle {
  return { name, fields: { ...DEFAULT_STYLE_VALUES } };
}

// Split into at most n comma fields; the last field keeps every remaining comma (the
// ASS Text field can contain commas and is always last in the Format).
function splitFields(rest: string, n: number): string[] {
  const parts = rest.split(",");
  if (parts.length <= n) return parts;
  return [...parts.slice(0, n - 1), parts.slice(n - 1).join(",")];
}

function parseFormatLine(line: string): string[] {
  return line
    .replace(/^Format\s*:/i, "")
    .split(",")
    .map((s) => s.trim());
}

export function parseAss(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const eol = detectEol(body);
  const finalNewline = /\r?\n$/.test(body);
  const lines = body.replace(/\r?\n$/, "").split(/\r?\n/);

  // Locate the [V4+ Styles] and [Events] Format lines.
  let section = "";
  let styleFormatIdx = -1;
  let eventsFormatIdx = -1;
  let assStyleFormat = DEFAULT_STYLE_FORMAT;
  let assFormat = DEFAULT_EVENT_FORMAT;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (/^\[/.test(trimmed)) {
      section = trimmed.toLowerCase();
    } else if (/^Format\s*:/i.test(lines[i])) {
      if (/^\[v4\+? styles\]$/.test(section) && styleFormatIdx < 0) {
        styleFormatIdx = i;
        assStyleFormat = parseFormatLine(lines[i]);
      } else if (section === "[events]" && eventsFormatIdx < 0) {
        eventsFormatIdx = i;
        assFormat = parseFormatLine(lines[i]);
      }
    }
  }

  if (eventsFormatIdx < 0) {
    // No Events section: keep the whole file as inert scriptInfo.
    return { format: "ass", cues: [], eol, bom, finalNewline, assScriptInfo: lines.join(eol), assFormat, assStyleFormat, styles: [] };
  }

  // Parse styles (when the styles section precedes events).
  const styles: AssStyle[] = [];
  let assScriptInfo: string;
  let assStylesTail: string | undefined;
  if (styleFormatIdx >= 0 && styleFormatIdx < eventsFormatIdx) {
    assScriptInfo = lines.slice(0, styleFormatIdx + 1).join(eol);
    const nameIdx = assStyleFormat.findIndex((f) => /^Name$/i.test(f));
    let pending: string[] = [];
    let lastStyleIdx = styleFormatIdx;
    for (let i = styleFormatIdx + 1; i < lines.length; i += 1) {
      if (/^\[/.test(lines[i].trim())) break; // next section ends the styles block
      if (/^Style\s*:/i.test(lines[i])) {
        const values = splitFields(lines[i].replace(/^Style\s*:\s?/i, ""), assStyleFormat.length);
        const name = (nameIdx >= 0 ? values[nameIdx] : values[0]) ?? "";
        const fields: Record<string, string> = {};
        assStyleFormat.forEach((n, j) => {
          if (j !== nameIdx) fields[n] = values[j] ?? "";
        });
        styles.push({ name, fields, notesBefore: pending.length ? pending.join(eol) : undefined });
        pending = [];
        lastStyleIdx = i;
      } else {
        pending.push(lines[i]);
      }
    }
    assStylesTail = lines.slice(lastStyleIdx + 1, eventsFormatIdx + 1).join(eol);
  } else {
    assScriptInfo = lines.slice(0, eventsFormatIdx + 1).join(eol);
  }

  // Parse events (Dialogue lines are cues; everything else is a note).
  const cues: Cue[] = [];
  let pending: string[] = [];
  const startI = assFormat.findIndex((f) => /^Start$/i.test(f));
  const endI = assFormat.findIndex((f) => /^End$/i.test(f));
  const textI = assFormat.findIndex((f) => /^Text$/i.test(f));
  for (let i = eventsFormatIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^Dialogue\s*:/i.test(line)) {
      const values = splitFields(line.replace(/^Dialogue\s*:\s?/i, ""), assFormat.length);
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
      pending.push(line);
    }
  }

  return {
    format: "ass",
    cues,
    eol,
    bom,
    finalNewline,
    assScriptInfo,
    assStyleFormat,
    styles,
    assStylesTail,
    assFormat,
    trailingNotes: pending.length ? pending.join(eol) : undefined,
  };
}

function serializeStyle(style: AssStyle, format: string[]): string {
  const fields = format.map((name) => (/^Name$/i.test(name) ? style.name : style.fields[name] ?? ""));
  return `Style: ${fields.join(",")}`;
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
  const styleFormat = doc.assStyleFormat ?? DEFAULT_STYLE_FORMAT;
  const eventFormat = doc.assFormat ?? DEFAULT_EVENT_FORMAT;
  const chunks: string[] = [doc.assScriptInfo ?? doc.header ?? ""];
  for (const style of doc.styles ?? []) {
    if (style.notesBefore) chunks.push(style.notesBefore);
    chunks.push(serializeStyle(style, styleFormat));
  }
  if (doc.assStylesTail) chunks.push(doc.assStylesTail);
  for (const cue of doc.cues) {
    if (cue.notesBefore) chunks.push(cue.notesBefore);
    chunks.push(serializeDialogue(cue, eventFormat));
  }
  if (doc.trailingNotes) chunks.push(doc.trailingNotes);
  let out = chunks.join(eol);
  if (doc.finalNewline) out += eol;
  return (doc.bom ? "\uFEFF" : "") + out;
}

export function styleNames(doc: SubtitleDoc): string[] {
  return (doc.styles ?? []).map((s) => s.name);
}

// The pieces of a fresh ASS scaffold, for converting SRT/VTT to ASS.
export function defaultAssParts(eol: string): { scriptInfo: string; styles: AssStyle[]; tail: string } {
  const scriptInfo = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1920",
    "PlayResY: 1080",
    "",
    "[V4+ Styles]",
    `Format: ${DEFAULT_STYLE_FORMAT.join(", ")}`,
  ].join(eol);
  const tail = ["", "[Events]", `Format: ${DEFAULT_EVENT_FORMAT.join(", ")}`].join(eol);
  return { scriptInfo, styles: [makeDefaultStyle("Default")], tail };
}

export const ASS_EVENT_FORMAT = DEFAULT_EVENT_FORMAT;

// --- ASS colour <-> hex (for the styles editor) --------------------------------------
// ASS colours are &HAABBGGRR (alpha, blue, green, red) or &HBBGGRR. The picker edits RGB;
// the alpha byte is preserved.

export function assColorToHex(ass: string): { hex: string; alpha: string } {
  const m = (ass || "").match(/&H([0-9a-fA-F]{1,8})/);
  if (!m) return { hex: "#ffffff", alpha: "00" };
  const h = m[1].padStart(ass.length >= 10 ? 8 : 6, "0");
  const has8 = h.length >= 8;
  const alpha = has8 ? h.slice(-8, -6) : "00";
  const bb = h.slice(-6, -4);
  const gg = h.slice(-4, -2);
  const rr = h.slice(-2);
  return { hex: `#${rr}${gg}${bb}`.toLowerCase(), alpha: alpha.toUpperCase() };
}

export function hexToAssColor(hex: string, alpha = "00"): string {
  const m = (hex || "").match(/^#?([0-9a-fA-F]{6})$/);
  const h = m ? m[1] : "ffffff";
  const rr = h.slice(0, 2);
  const gg = h.slice(2, 4);
  const bb = h.slice(4, 6);
  return `&H${alpha}${bb}${gg}${rr}`.toUpperCase();
}
