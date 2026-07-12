import { describe, it, expect } from "vitest";
import { parseSrt, serializeSrt } from "./srt";
import { parseVtt, serializeVtt } from "./vtt";
import { parseSubtitles, serializeSubtitles, detectFormat, convertDoc } from "./subtitles";
import { parseTimestamp, formatTimestamp, cps, visibleText } from "./cue";

// Golden fixtures are canonically formatted so parse -> serialize is byte-identical.
const SRT_GOLDEN = [
  "1",
  "00:00:01,000 --> 00:00:04,000",
  "Hello, world.",
  "",
  "2",
  "00:00:05,500 --> 00:00:08,200",
  "Second line one",
  "Second line two",
  "",
  "3",
  "00:01:02,000 --> 00:01:04,000",
  "<i>Italic</i> text",
  "",
].join("\n");

const VTT_GOLDEN = [
  "WEBVTT - Some title",
  "",
  "NOTE",
  "This is a multi-line",
  "comment block.",
  "",
  "STYLE",
  "::cue { color: yellow }",
  "",
  "intro",
  "00:00:01.000 --> 00:00:04.000 line:0 position:20%",
  "Hello, world.",
  "",
  "00:00:05.500 --> 00:00:08.200",
  "Second line one",
  "Second line two",
  "",
].join("\n");

describe("timestamps", () => {
  it("parses SRT comma timestamps", () => {
    expect(parseTimestamp("01:02:03,004")).toBe(((1 * 60 + 2) * 60 + 3) * 1000 + 4);
  });
  it("parses VTT dot timestamps with and without hours", () => {
    expect(parseTimestamp("00:00:05.500")).toBe(5500);
    expect(parseTimestamp("05:30.250")).toBe(5 * 60000 + 30000 + 250);
  });
  it("formats with the requested separator", () => {
    expect(formatTimestamp(3661004, ",")).toBe("01:01:01,004");
    expect(formatTimestamp(5500, ".")).toBe("00:00:05.500");
  });
  it("round-trips a value", () => {
    expect(parseTimestamp(formatTimestamp(1234567, ","))).toBe(1234567);
  });
});

describe("SRT", () => {
  it("parses cues, index and multi-line text", () => {
    const doc = parseSrt(SRT_GOLDEN);
    expect(doc.cues).toHaveLength(3);
    expect(doc.cues[0].startMs).toBe(1000);
    expect(doc.cues[0].endMs).toBe(4000);
    expect(doc.cues[1].text).toBe("Second line one\nSecond line two");
  });
  it("round-trips byte-for-byte", () => {
    expect(serializeSrt(parseSrt(SRT_GOLDEN))).toBe(SRT_GOLDEN);
  });
  it("renumbers indices sequentially on write", () => {
    const messy = "5\n00:00:01,000 --> 00:00:02,000\nA\n\n9\n00:00:03,000 --> 00:00:04,000\nB\n";
    const out = serializeSrt(parseSrt(messy));
    expect(out.startsWith("1\n")).toBe(true);
    expect(out).toContain("\n2\n");
  });
  it("preserves CRLF line endings", () => {
    const crlf = SRT_GOLDEN.replace(/\n/g, "\r\n");
    expect(serializeSrt(parseSrt(crlf))).toBe(crlf);
  });
  it("preserves a BOM", () => {
    const withBom = "﻿" + SRT_GOLDEN;
    expect(serializeSrt(parseSrt(withBom))).toBe(withBom);
  });
});

describe("VTT", () => {
  it("parses header, NOTE, STYLE and cues", () => {
    const doc = parseVtt(VTT_GOLDEN);
    expect(doc.header).toBe("WEBVTT - Some title");
    expect(doc.cues).toHaveLength(2);
    expect(doc.cues[0].identifier).toBe("intro");
    expect(doc.cues[0].settings).toBe("line:0 position:20%");
    expect(doc.cues[0].notesBefore).toContain("NOTE");
    expect(doc.cues[0].notesBefore).toContain("STYLE");
  });
  it("round-trips byte-for-byte", () => {
    expect(serializeVtt(parseVtt(VTT_GOLDEN))).toBe(VTT_GOLDEN);
  });
  it("preserves CRLF line endings", () => {
    const crlf = VTT_GOLDEN.replace(/\n/g, "\r\n");
    expect(serializeVtt(parseVtt(crlf))).toBe(crlf);
  });
});

describe("dispatch and conversion", () => {
  it("detects format from extension and content", () => {
    expect(detectFormat("x.vtt", "")).toBe("vtt");
    expect(detectFormat("x.srt", "")).toBe("srt");
    expect(detectFormat(undefined, "WEBVTT\n\n...")).toBe("vtt");
    expect(detectFormat(undefined, "1\n00:00:01,000 --> ...")).toBe("srt");
  });
  it("parses through the dispatcher", () => {
    expect(parseSubtitles(VTT_GOLDEN, "x.vtt").format).toBe("vtt");
    expect(serializeSubtitles(parseSubtitles(SRT_GOLDEN, "x.srt"))).toBe(SRT_GOLDEN);
  });
  it("converts VTT to SRT dropping VTT-only trivia", () => {
    const srt = convertDoc(parseVtt(VTT_GOLDEN), "srt");
    expect(srt.format).toBe("srt");
    expect(srt.header).toBeUndefined();
    expect(srt.cues[0].identifier).toBeUndefined();
    const out = serializeSubtitles(srt);
    expect(out).toContain("00:00:01,000 --> 00:00:04,000");
  });
});

describe("metrics", () => {
  it("strips markup for visible length", () => {
    expect(visibleText("<i>Hi</i> {\\an8}there")).toBe("Hi there");
  });
  it("computes CPS over duration", () => {
    // "Hello" = 5 chars over 1s -> 5 cps
    expect(cps({ id: "x", startMs: 0, endMs: 1000, text: "Hello" })).toBe(5);
    expect(cps({ id: "x", startMs: 0, endMs: 0, text: "Hello" })).toBe(0);
  });
});
