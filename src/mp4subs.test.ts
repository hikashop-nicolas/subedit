import { describe, it, expect } from "vitest";
import { extractMp4Subtitles, sampleOffsets, sampleTimesMs, decodeTx3g, decodeWvtt, decodeMdhdLanguage, cuesToVtt } from "./mp4subs";

// --- byte helpers to build a minimal progressive MP4 ---------------------------------
const enc = new TextEncoder();
const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
};
const u16 = (n: number) => {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n);
  return b;
};
const cat = (...arrs: Uint8Array[]): Uint8Array => {
  const total = arrs.reduce((a, x) => a + x.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};
const box = (type: string, ...parts: Uint8Array[]): Uint8Array => {
  const body = cat(...parts);
  return cat(u32(body.length + 8), enc.encode(type), body);
};
const full = (type: string, ...parts: Uint8Array[]): Uint8Array => box(type, new Uint8Array([0, 0, 0, 0]), ...parts);
const tx3gSample = (s: string) => {
  const t = enc.encode(s);
  return cat(u16(t.length), t);
};

describe("mp4 sample-table math", () => {
  it("computes sample offsets across a chunk", () => {
    const offs = sampleOffsets([{ firstChunk: 1, samplesPerChunk: 2 }], [1000], [4, 7]);
    expect(offs).toEqual([{ offset: 1000, size: 4 }, { offset: 1004, size: 7 }]);
  });
  it("computes sample times from stts", () => {
    const times = sampleTimesMs([{ count: 2, delta: 1000 }], 1000);
    expect(times).toEqual([{ startMs: 0, durMs: 1000 }, { startMs: 1000, durMs: 1000 }]);
  });
});

describe("mp4 sample decoders", () => {
  it("decodes a tx3g sample (length-prefixed UTF-8)", () => {
    expect(decodeTx3g(tx3gSample("Hello"))).toBe("Hello");
    expect(decodeTx3g(u16(0))).toBe(""); // empty sample = gap
  });
  it("decodes a wvtt sample (vttc > payl)", () => {
    const payl = box("payl", enc.encode("Line one"));
    const vttc = box("vttc", payl);
    expect(decodeWvtt(vttc)).toBe("Line one");
  });
  it("maps mdhd language codes", () => {
    const eng = ("e".charCodeAt(0) - 0x60) * 1024 + ("n".charCodeAt(0) - 0x60) * 32 + ("g".charCodeAt(0) - 0x60);
    expect(decodeMdhdLanguage(eng)).toBe("en");
    expect(decodeMdhdLanguage("jpn")).toBe("ja");
    expect(decodeMdhdLanguage("und")).toBe("");
  });
  it("serialises cues to WebVTT", () => {
    const vtt = cuesToVtt([{ startMs: 1000, endMs: 3000, text: "Hi" }]);
    expect(vtt).toContain("WEBVTT");
    expect(vtt).toContain("00:00:01.000 --> 00:00:03.000");
    expect(vtt).toContain("Hi");
  });
});

describe("extractMp4Subtitles", () => {
  it("extracts a tx3g subtitle track from a minimal progressive MP4", () => {
    const ftyp = box("ftyp", enc.encode("isom"), u32(0), enc.encode("isom"));
    const s1 = tx3gSample("Hi");
    const s2 = tx3gSample("There");
    const mdat = box("mdat", s1, s2);
    const mdatPayloadOffset = ftyp.length + 8; // after ftyp, past mdat's 8-byte header
    const engLang = ("e".charCodeAt(0) - 0x60) * 1024 + ("n".charCodeAt(0) - 0x60) * 32 + ("g".charCodeAt(0) - 0x60);
    const mdhd = full("mdhd", u32(0), u32(0), u32(1000), u32(2000), u16(engLang), u16(0));
    const hdlr = full("hdlr", u32(0), enc.encode("sbtl"), u32(0), u32(0), u32(0), new Uint8Array([0]));
    const stsd = full("stsd", u32(1), box("tx3g", new Uint8Array(8)));
    const stts = full("stts", u32(1), u32(2), u32(1000));
    const stsc = full("stsc", u32(1), u32(1), u32(2), u32(1));
    const stsz = full("stsz", u32(0), u32(2), u32(s1.length), u32(s2.length));
    const stco = full("stco", u32(1), u32(mdatPayloadOffset));
    const stbl = box("stbl", stsd, stts, stsc, stsz, stco);
    const minf = box("minf", stbl);
    const mdia = box("mdia", mdhd, hdlr, minf);
    const trak = box("trak", mdia);
    const moov = box("moov", trak);
    const mp4 = cat(ftyp, mdat, moov);

    const tracks = extractMp4Subtitles(mp4);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].language).toBe("en");
    expect(tracks[0].text).toContain("Hi");
    expect(tracks[0].text).toContain("There");
    expect(tracks[0].text).toContain("00:00:00.000 --> 00:00:01.000");
  });
});
