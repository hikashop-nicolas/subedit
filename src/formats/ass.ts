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
} from "../cue";
import { parseEmbeddedFonts, isSectionHeader, encodeEmbeddedFont, embeddedFontFilename, type EmbeddedFont } from "../fonts";

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

// A style name not already used in the document (appends " 2", " 3", ... on collision).
export function uniqueStyleName(doc: SubtitleDoc, base: string): string {
  const names = new Set((doc.styles ?? []).map((s) => s.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
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
    const m = line.match(/^(Dialogue|Comment)\s*:\s?/i);
    if (m) {
      const values = splitFields(line.slice(m[0].length), assFormat.length);
      const assFields: Record<string, string> = {};
      assFormat.forEach((name, j) => {
        if (j !== startI && j !== endI && j !== textI) assFields[name] = values[j] ?? "";
      });
      cues.push({
        id: newCueId(),
        startMs: startI >= 0 ? parseTimestamp(values[startI] ?? "") || 0 : 0,
        endMs: endI >= 0 ? parseTimestamp(values[endI] ?? "") || 0 : 0,
        text: textI >= 0 ? values[textI] ?? "" : "",
        assKind: /^d/i.test(m[1]) ? "Dialogue" : "Comment",
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

function serializeDialogue(cue: Cue, format: string[], defaultStyle: string): string {
  const fields = format.map((name) => {
    if (/^Start$/i.test(name)) return formatAssTime(cue.startMs);
    if (/^End$/i.test(name)) return formatAssTime(cue.endMs);
    if (/^Text$/i.test(name)) return cue.text;
    // A Dialogue must reference a real style; an empty Style makes renderers (libass) drop the
    // cue. Cues added on an empty track have none, so fall back to a defined style.
    if (/^Style$/i.test(name)) return cue.assFields?.Style || defaultStyle;
    return cue.assFields?.[name] ?? "";
  });
  return `${cue.assKind ?? "Dialogue"}: ${fields.join(",")}`;
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
  const defaultStyle = doc.styles?.[0]?.name ?? "Default";
  for (const cue of doc.cues) {
    if (cue.notesBefore) chunks.push(cue.notesBefore);
    chunks.push(serializeDialogue(cue, eventFormat, defaultStyle));
  }
  if (doc.trailingNotes) chunks.push(doc.trailingNotes);
  let out = chunks.join(eol);
  if (doc.finalNewline) out += eol;
  return (doc.bom ? "\uFEFF" : "") + out;
}

export function styleNames(doc: SubtitleDoc): string[] {
  return (doc.styles ?? []).map((s) => s.name);
}

// Family names of fonts embedded in the file's [Fonts] section. Each font's binary is
// decoded and its real family name read from the name table; if that fails we fall back
// to the "fontname: Family_B<enc>.ttf" filename with the _<digits> suffix stripped.
export function embeddedFontNames(doc: SubtitleDoc): string[] {
  const names = new Set<string>();
  for (const f of embeddedFonts(doc)) {
    const name = embeddedFamily(f);
    if (name) names.add(name);
  }
  return [...names];
}

function embeddedFamily(f: EmbeddedFont): string {
  return f.family ?? f.filename.replace(/(?:_B?I?U?\d+)?\.(?:ttf|otf|ttc)$/i, "").trim();
}

// The doc parts that may hold a [Fonts] section (it is kept verbatim in one of them).
type FontPart = "assScriptInfo" | "assStylesTail" | "trailingNotes";
const FONT_PARTS: FontPart[] = ["assStylesTail", "trailingNotes", "assScriptInfo"];

// Embedded fonts, decoded. Memoized on the raw parts, which change only on a font edit.
let fontsMemo: { key: string; fonts: EmbeddedFont[] } | null = null;
export function embeddedFonts(doc: SubtitleDoc): EmbeddedFont[] {
  const key = FONT_PARTS.map((p) => doc[p] ?? "").join("\n");
  if (!/^fontname:/im.test(key)) return [];
  if (fontsMemo?.key !== key) fontsMemo = { key, fonts: parseEmbeddedFonts(key) };
  return fontsMemo.fonts;
}

// [start, end) line range of the [Fonts] section in lines, or null.
function fontsRange(lines: string[]): [number, number] | null {
  const at = lines.findIndex((l) => /^\[fonts\]\s*$/i.test(l.trim()));
  if (at < 0) return null;
  let end = at + 1;
  while (end < lines.length && !isSectionHeader(lines[end])) end++;
  return [at, end];
}

export interface FontToEmbed {
  family: string;
  bold: boolean;
  italic: boolean;
  bytes: Uint8Array;
  /** File extension: ttf, otf or ttc. */
  ext: string;
}

// Add fonts to the [Fonts] section, creating it before [Events] when missing. Entries go
// after the existing ones; nothing else in the file changes.
export function embedFonts(doc: SubtitleDoc, fonts: readonly FontToEmbed[]): void {
  if (!fonts.length) return;
  const eol = doc.eol;
  const taken = new Set(embeddedFonts(doc).map((f) => f.filename.toLowerCase()));
  const entries = fonts.map((f) => {
    let name = embeddedFontFilename(f.family, f.bold, f.italic, f.ext);
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = embeddedFontFilename(`${f.family} ${n}`, f.bold, f.italic, f.ext);
    taken.add(name.toLowerCase());
    return encodeEmbeddedFont(name, f.bytes, eol);
  });
  for (const part of FONT_PARTS) {
    const text = doc[part];
    if (text == null) continue;
    const lines = text.split(/\r?\n/);
    const range = fontsRange(lines);
    if (!range) continue;
    let at = range[1];
    while (at > range[0] + 1 && lines[at - 1].trim() === "") at--; // before the section's blank lines
    lines.splice(at, 0, ...entries);
    doc[part] = lines.join(eol);
    return;
  }
  // No [Fonts] yet: insert it just before the [Events] header.
  const part: FontPart = doc.assStylesTail != null ? "assStylesTail" : "assScriptInfo";
  const lines = (doc[part] ?? "").split(/\r?\n/);
  let at = lines.findIndex((l) => /^\[events\]\s*$/i.test(l.trim()));
  if (at < 0) at = lines.length;
  const block = ["[Fonts]", ...entries, ""];
  // Keep one blank line between the previous section and [Fonts].
  if (at > 0 && lines[at - 1].trim() !== "") block.unshift("");
  lines.splice(at, 0, ...block);
  doc[part] = lines.join(eol);
}

// Remove every embedded file of a family (case-insensitive); an emptied [Fonts] section
// goes too. Returns how many files were removed.
export function removeEmbeddedFamily(doc: SubtitleDoc, family: string): number {
  const want = family.trim().toLowerCase();
  let removed = 0;
  for (const part of FONT_PARTS) {
    const text = doc[part];
    if (text == null) continue;
    const lines = text.split(/\r?\n/);
    const range = fontsRange(lines);
    if (!range) continue;
    const body = lines.slice(range[0] + 1, range[1]);
    const kept: string[] = [];
    for (let i = 0; i < body.length; ) {
      const m = body[i].match(/^fontname:\s*(.+?)\s*$/i);
      if (!m) {
        kept.push(body[i++]);
        continue;
      }
      let j = i + 1;
      while (j < body.length && body[j].trim() !== "" && !/^fontname:/i.test(body[j])) j++;
      const [f] = parseEmbeddedFonts(body.slice(i, j).join("\n"));
      if (f && embeddedFamily(f).toLowerCase() === want) removed++;
      else kept.push(...body.slice(i, j));
      i = j;
    }
    if (kept.length === body.length) continue;
    const empty = kept.every((l) => l.trim() === "");
    if (empty) {
      lines.splice(range[0], range[1] - range[0]); // the header and its body, trailing blank included
    } else {
      lines.splice(range[0] + 1, body.length, ...kept);
    }
    doc[part] = lines.join(doc.eol);
  }
  return removed;
}

// The text to hand a renderer that is given the embedded fonts separately: the [Fonts]
// section is dropped (libass would add a copy of each font on every track reload).
export function withoutFontsSection(text: string): string {
  if (!/^\[fonts\]\s*$/im.test(text)) return text;
  const lines = text.split(/(?<=\n)/);
  const out: string[] = [];
  let skip = false;
  for (const l of lines) {
    const t = l.trim();
    if (isSectionHeader(t)) skip = /^\[fonts\]$/i.test(t);
    if (!skip) out.push(l);
  }
  return out.join("");
}

/** A face the document draws with: a family at a weight, upright or italic. */
export interface FontUse {
  family: string;
  weight: number;
  italic: boolean;
}

// ASS Bold: 0 off, -1 (or 1) on, other values a weight (libass reads them so).
function boldWeight(v: string | undefined): number {
  const n = parseInt(v ?? "0", 10) || 0;
  if (n === 0) return 400;
  return n === -1 || n === 1 ? 700 : n;
}

// Every face the styles and the cues' \fn \b \i overrides use, deduplicated. Cheap and a
// slight overestimate: a cue's override weights apply to all of its families.
export function fontUsage(doc: SubtitleDoc): FontUse[] {
  const out = new Map<string, FontUse>();
  const add = (family: string, weight: number, italic: boolean): void => {
    const name = family.replace(/^@/, "").trim();
    if (!name) return;
    const key = `${name.toLowerCase()}|${weight}|${italic ? 1 : 0}`;
    if (!out.has(key)) out.set(key, { family: name, weight, italic });
  };
  const styles = new Map((doc.styles ?? []).map((s) => [s.name, s]));
  const used = new Set<string>();
  for (const cue of doc.cues) {
    if (cue.assKind === "Comment") continue;
    const style = styles.get(cue.assFields?.Style ?? "") ?? styles.get("Default") ?? doc.styles?.[0];
    if (style) used.add(style.name);
    if (!cue.text.includes("{")) continue;
    const base = style?.fields.Fontname ?? "";
    const families = new Set<string>([base]);
    const weights = new Set<number>([boldWeight(style?.fields.Bold)]);
    const italics = new Set<boolean>([(parseInt(style?.fields.Italic ?? "0", 10) || 0) !== 0]);
    for (const m of cue.text.matchAll(/\\fn([^\\}]*)/g)) families.add(m[1]);
    for (const m of cue.text.matchAll(/\\b(\d+)/g)) weights.add(boldWeight(m[1]));
    if (/\\i1/.test(cue.text)) italics.add(true);
    for (const f of families) for (const w of weights) for (const i of italics) add(f, w, i);
  }
  // Styles: the ones cues use, or all of them for a file without cues yet.
  for (const s of doc.styles ?? []) {
    if (used.size && !used.has(s.name)) continue;
    add(s.fields.Fontname ?? "", boldWeight(s.fields.Bold), (parseInt(s.fields.Italic ?? "0", 10) || 0) !== 0);
  }
  return [...out.values()];
}

// The script resolution (\pos and drawings are in these coordinates). ASS defaults to
// 384x288 when unset.
export function getPlayRes(doc: SubtitleDoc): { x: number; y: number } {
  const info = doc.assScriptInfo ?? "";
  const x = parseInt(info.match(/^\s*PlayResX\s*:\s*(\d+)/im)?.[1] ?? "", 10);
  const y = parseInt(info.match(/^\s*PlayResY\s*:\s*(\d+)/im)?.[1] ?? "", 10);
  return { x: x || 384, y: y || 288 };
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
