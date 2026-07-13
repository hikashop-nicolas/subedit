import { describe, it, expect } from "vitest";
import { parseEmbeddedFonts } from "./fonts";

// Build a minimal sfnt with a single `name` table carrying one Windows (UTF-16BE) family
// record, so we can round-trip it through the ASS font encoding and read the name back.
function makeFont(family: string): Uint8Array {
  const str = new Uint8Array(family.length * 2);
  for (let i = 0; i < family.length; i++) str[i * 2 + 1] = family.charCodeAt(i); // ASCII -> UTF-16BE
  const nameLen = 6 + 12 + str.length;
  const total = 12 + 16 + nameLen;
  const b = new Uint8Array(total);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 0x00010000); // sfnt version
  dv.setUint16(4, 1); // numTables
  // table record
  dv.setUint32(12, 0x6e616d65); // 'name'
  dv.setUint32(20, 28); // offset
  dv.setUint32(24, nameLen); // length
  // name table @28
  dv.setUint16(28 + 0, 0); // format
  dv.setUint16(28 + 2, 1); // count
  dv.setUint16(28 + 4, 6 + 12); // stringOffset (within name table)
  dv.setUint16(28 + 6, 3); // platformID = Windows
  dv.setUint16(28 + 8, 1); // encodingID
  dv.setUint16(28 + 10, 0x0409); // languageID
  dv.setUint16(28 + 12, 1); // nameID = family
  dv.setUint16(28 + 14, str.length); // length
  dv.setUint16(28 + 16, 0); // offset into storage
  b.set(str, 28 + 6 + 12);
  return b;
}

// Inverse of the decoder: 3 bytes -> 4 chars (6-bit value + 33), wrapped at 80 columns.
function uuencode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = Math.min(3, bytes.length - i);
    const v = [b0 >> 2, ((b0 & 3) << 4) | (b1 >> 4), ((b1 & 15) << 2) | (b2 >> 6), b2 & 63];
    for (let k = 0; k < n + 1; k++) out += String.fromCharCode(v[k] + 33);
  }
  return out.replace(/(.{80})/g, "$1\n");
}

describe("embedded font name decoding", () => {
  it("reads the real family name from an embedded font binary", () => {
    const encoded = uuencode(makeFont("Test Family"));
    const raw = ["[Fonts]", "fontname: Whatever_0.ttf", encoded, "", "[Events]"].join("\n");
    const fonts = parseEmbeddedFonts(raw);
    expect(fonts).toHaveLength(1);
    expect(fonts[0].family).toBe("Test Family");
  });

  it("falls back to null family for undecodable data (caller uses the filename)", () => {
    const raw = ["[Fonts]", "fontname: Broken_0.ttf", "!!!!garbage!!!!", "[Events]"].join("\n");
    const fonts = parseEmbeddedFonts(raw);
    expect(fonts[0].filename).toBe("Broken_0.ttf");
    expect(fonts[0].family).toBeNull();
  });
});
