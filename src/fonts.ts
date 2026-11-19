// Read the real family names of fonts embedded in an ASS [Fonts] section. Each font is a
// "fontname: <file>" line followed by the font binary encoded in VSFilter's UUEncode-like
// scheme (3 bytes -> 4 chars, each a 6-bit value + 33). We decode enough to read the
// TrueType/OpenType `name` table; anything unparseable falls back to the filename.

export interface EmbeddedFont {
  filename: string;
  family: string | null;
  /** The decoded font file. */
  bytes: Uint8Array;
}

// Decode VSFilter-embedded font data (a run of encoded lines) to bytes.
export function uudecode(encoded: string): Uint8Array {
  const chars = encoded.replace(/[^\x21-\x60]/g, ""); // keep only the 33..96 alphabet
  const out: number[] = [];
  for (let i = 0; i < chars.length; i += 4) {
    const v = [0, 0, 0, 0].map((_, k) => (i + k < chars.length ? chars.charCodeAt(i + k) - 33 : -1));
    const n = Math.min(4, chars.length - i);
    if (n >= 2) out.push(((v[0] << 2) | (v[1] >> 4)) & 0xff);
    if (n >= 3) out.push(((v[1] << 4) | (v[2] >> 2)) & 0xff);
    if (n >= 4) out.push(((v[2] << 6) | v[3]) & 0xff);
  }
  return new Uint8Array(out);
}

// The family (ID 1), full (4) and typographic family (16) names of a sfnt/TTC binary (its
// first face), Windows records preferred. Empty on any structural problem.
export function fontNames(bytes: Uint8Array): { 1?: string; 4?: string; 16?: string } {
  const out: { [id: number]: string } = {};
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (o: number) => dv.getUint16(o);
    const u32 = (o: number) => dv.getUint32(o);
    let dir = 0;
    if (u32(0) === 0x74746366) dir = u32(12); // 'ttcf' collection: use the first font
    const numTables = u16(dir + 4);
    let nameOff = -1;
    for (let i = 0; i < numTables; i++) {
      const rec = dir + 12 + i * 16;
      if (u32(rec) === 0x6e616d65) {
        nameOff = u32(rec + 8); // 'name'
        break;
      }
    }
    if (nameOff < 0) return out;
    const count = u16(nameOff + 2);
    const storage = nameOff + u16(nameOff + 4);
    const win: { [id: number]: boolean } = {};
    for (let i = 0; i < count; i++) {
      const rec = nameOff + 6 + i * 12;
      const platformID = u16(rec);
      const nameID = u16(rec + 6);
      const len = u16(rec + 8);
      const off = storage + u16(rec + 10);
      if (nameID !== 1 && nameID !== 4 && nameID !== 16) continue;
      if (win[nameID] && platformID !== 3) continue;
      let s = "";
      if (platformID === 3 || platformID === 0) {
        for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(u16(off + j)); // UTF-16BE
      } else {
        for (let j = 0; j < len; j++) s += String.fromCharCode(bytes[off + j]); // Mac/ASCII
      }
      if (!s.trim() || (out[nameID] && platformID !== 3)) continue;
      out[nameID] = s.trim();
      if (platformID === 3) win[nameID] = true;
    }
  } catch {
    /* leave what was read */
  }
  return out;
}

// The family a font belongs to: typographic family (16) groups a SemiBold file with its
// family; then 1, then the full name.
function fontFamily(bytes: Uint8Array): string | null {
  const n = fontNames(bytes);
  return n[16] ?? n[1] ?? n[4] ?? null;
}

// A [Section] header. Encoded font data uses only 0x21..0x60, so a line like "[A]" inside
// it is data: a real header has a lowercase letter.
export function isSectionHeader(line: string): boolean {
  return /^\[[^\]]*[a-z][^\]]*\]$/.test(line.trim());
}

// Parse every embedded font declared in the raw ASS text (the section is byte-preserved,
// so we scan for its "fontname:" markers directly).
export function parseEmbeddedFonts(raw: string): EmbeddedFont[] {
  const lines = raw.split(/\r?\n/);
  const fonts: EmbeddedFont[] = [];
  let current: { filename: string; data: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const bytes = uudecode(current.data.join(""));
    const family = bytes.length ? fontFamily(bytes) : null;
    fonts.push({ filename: current.filename, family, bytes });
    current = null;
  };
  for (const line of lines) {
    const m = line.match(/^fontname:\s*(.+?)\s*$/i);
    if (m) {
      flush();
      current = { filename: m[1], data: [] };
    } else if (isSectionHeader(line)) {
      flush(); // a new [Section] ends the font list
    } else if (current) {
      current.data.push(line);
    }
  }
  flush();
  return fonts;
}

// The inverse of uudecode, as Aegisub writes it: 3 bytes -> 4 chars (6-bit value + 33), a
// short tail as 2 or 3 chars, wrapped at 80 columns with no line break after the last.
export function uuencode(bytes: Uint8Array, eol = "\r\n"): string {
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = Math.min(3, bytes.length - i);
    const b0 = bytes[i];
    const b1 = n > 1 ? bytes[i + 1] : 0;
    const b2 = n > 2 ? bytes[i + 2] : 0;
    const v = [b0 >> 2, ((b0 & 3) << 4) | (b1 >> 4), ((b1 & 15) << 2) | (b2 >> 6), b2 & 63];
    for (let k = 0; k <= n; k++) {
      line += String.fromCharCode(v[k] + 33);
      if (line.length === 80) {
        lines.push(line);
        line = "";
      }
    }
  }
  if (line) lines.push(line);
  return lines.join(eol);
}

// The SSA name for an embedded font file: "<name>_<B><I><charset>.<ext>", e.g. Lobster_0.ttf,
// Klee One_B0.ttf. Renderers read the family from the font itself; this is for people.
export function embeddedFontFilename(family: string, bold: boolean, italic: boolean, ext: string, charset = 0): string {
  const base = family.replace(/[\\/:*?"<>|\x00-\x1f]/g, "").trim() || "font";
  return `${base}_${bold ? "B" : ""}${italic ? "I" : ""}${charset}.${ext}`;
}

// One "fontname:" entry of a [Fonts] section, its lines joined with eol.
export function encodeEmbeddedFont(filename: string, bytes: Uint8Array, eol: string): string {
  return `fontname: ${filename}${eol}${uuencode(bytes, eol)}`;
}
