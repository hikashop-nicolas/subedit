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

describe("embedding fonts in [Fonts]", async () => {
  const { uuencode: encode, uudecode } = await import("./fonts");
  const { parseAss, serializeAss, embedFonts, embeddedFonts, embeddedFontNames, removeEmbeddedFamily, withoutFontsSection, fontUsage } = await import("./formats/ass");

  const ASS = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Lobster,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1",
    "Style: Loud,Lobster,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello",
    "Dialogue: 0,0:00:03.00,0:00:05.00,Loud,,0,0,0,,{\\fnKlee One\\i1}Bold",
    "",
  ].join("\r\n");

  it("encode then decode returns identical bytes, any tail length", () => {
    for (const len of [0, 1, 2, 3, 4, 5, 59, 60, 61, 62, 1000, 4099]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 151 + 7) & 0xff;
      const text = encode(bytes, "\r\n");
      expect(uudecode(text)).toEqual(bytes);
      const lines = text ? text.split("\r\n") : [];
      for (const l of lines.slice(0, -1)) expect(l.length).toBe(80);
      if (lines.length) expect(lines[lines.length - 1].length).toBeLessThanOrEqual(80);
    }
  });

  it("adds a [Fonts] section before [Events], reads it back, removes it byte-identically", () => {
    const doc = parseAss(ASS);
    const regular = makeFont("Lobster");
    const bold = new Uint8Array([...makeFont("Lobster"), 0x42]);
    embedFonts(doc, [
      { family: "Lobster", bold: false, italic: false, bytes: regular, ext: "ttf" },
      { family: "Lobster", bold: true, italic: false, bytes: bold, ext: "ttf" },
    ]);
    const out = serializeAss(doc);
    expect(out).toContain("\r\n\r\n[Fonts]\r\nfontname: Lobster_0.ttf\r\n");
    expect(out).toContain("fontname: Lobster_B0.ttf\r\n");
    expect(out.indexOf("[Fonts]")).toBeLessThan(out.indexOf("[Events]"));
    expect(out).toMatch(/\r\n\r\n\[Events\]/);
    // Reload: same names, same bytes, and a byte-identical round trip.
    const again = parseAss(out);
    expect(serializeAss(again)).toBe(out);
    expect(embeddedFontNames(again)).toEqual(["Lobster"]);
    const files = embeddedFonts(again);
    expect(files.map((f) => f.filename)).toEqual(["Lobster_0.ttf", "Lobster_B0.ttf"]);
    expect(files[0].bytes).toEqual(regular);
    expect(files[1].bytes).toEqual(bold);
    // Remove: the file is exactly what it was.
    expect(removeEmbeddedFamily(again, "lobster")).toBe(2);
    expect(serializeAss(again)).toBe(ASS);
  });

  it("appends to an existing [Fonts] section and keeps the rest", () => {
    const existing = ASS.replace("\r\n[Events]", "\r\n[Fonts]\r\nfontname: Other_0.ttf\r\n" + encode(makeFont("Other"), "\r\n") + "\r\n\r\n[Events]");
    const doc = parseAss(existing);
    expect(serializeAss(doc)).toBe(existing); // untouched files stay byte-identical
    embedFonts(doc, [{ family: "Lobster", bold: false, italic: false, bytes: makeFont("Lobster"), ext: "ttf" }]);
    const out = serializeAss(doc);
    expect(out.match(/\[Fonts\]/g)).toHaveLength(1);
    expect(embeddedFontNames(parseAss(out))).toEqual(["Other", "Lobster"]);
    removeEmbeddedFamily(doc, "Lobster");
    expect(serializeAss(doc)).toBe(existing);
  });

  it("treats encoded lines that look like [A] as data, not a section", () => {
    const raw = ["[Fonts]", "fontname: X_0.ttf", "[ABC]", "!!!!", "[Events]"].join("\n");
    expect(parseEmbeddedFonts(raw)[0].bytes.length).toBeGreaterThan(0);
    expect(withoutFontsSection(raw + "\n")).toBe("[Events]\n");
  });

  it("lists the faces the styles and overrides use", () => {
    const uses = fontUsage(parseAss(ASS)).map((u) => `${u.family}/${u.weight}/${u.italic ? "i" : ""}`).sort();
    expect(uses).toEqual(["Klee One/700/", "Klee One/700/i", "Lobster/400/", "Lobster/700/", "Lobster/700/i"]);
  });
});
