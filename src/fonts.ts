// Read the real family names of fonts embedded in an ASS [Fonts] section. Each font is a
// "fontname: <file>" line followed by the font binary encoded in VSFilter's UUEncode-like
// scheme (3 bytes -> 4 chars, each a 6-bit value + 33). We decode enough to read the
// TrueType/OpenType `name` table; anything unparseable falls back to the filename.

export interface EmbeddedFont {
  filename: string;
  family: string | null;
}

// Decode VSFilter-embedded font data (a run of encoded lines) to bytes.
function uudecode(encoded: string): Uint8Array {
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

// Read the family (name ID 1) or full name (4) from a sfnt/TTC font binary. Prefers the
// Windows platform record. Returns null on any structural problem.
function fontFamily(bytes: Uint8Array): string | null {
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
    if (nameOff < 0) return null;
    const count = u16(nameOff + 2);
    const storage = nameOff + u16(nameOff + 4);
    let best: string | null = null;
    let bestScore = -1;
    for (let i = 0; i < count; i++) {
      const rec = nameOff + 6 + i * 12;
      const platformID = u16(rec);
      const nameID = u16(rec + 6);
      const len = u16(rec + 8);
      const off = storage + u16(rec + 10);
      if (nameID !== 1 && nameID !== 4) continue;
      let s = "";
      if (platformID === 3 || platformID === 0) {
        for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(u16(off + j)); // UTF-16BE
      } else {
        for (let j = 0; j < len; j++) s += String.fromCharCode(bytes[off + j]); // Mac/ASCII
      }
      const score = (nameID === 1 ? 2 : 0) + (platformID === 3 ? 1 : 0);
      if (s.trim() && score > bestScore) {
        best = s.trim();
        bestScore = score;
      }
    }
    return best;
  } catch {
    return null;
  }
}

// Parse every embedded font declared in the raw ASS text (the section is byte-preserved,
// so we scan for its "fontname:" markers directly).
export function parseEmbeddedFonts(raw: string): EmbeddedFont[] {
  const lines = raw.split(/\r?\n/);
  const fonts: EmbeddedFont[] = [];
  let current: { filename: string; data: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const family = current.data.length ? fontFamily(uudecode(current.data.join(""))) : null;
    fonts.push({ filename: current.filename, family });
    current = null;
  };
  for (const line of lines) {
    const m = line.match(/^fontname:\s*(.+?)\s*$/i);
    if (m) {
      flush();
      current = { filename: m[1], data: [] };
    } else if (/^\[.+\]\s*$/.test(line)) {
      flush(); // a new [Section] ends the font list
    } else if (current) {
      current.data.push(line);
    }
  }
  flush();
  return fonts;
}
