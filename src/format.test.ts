import { describe, it, expect } from "vitest";
import { parseSrt, serializeSrt } from "./formats/srt";
import { parseVtt, serializeVtt } from "./formats/vtt";
import { parseAss, serializeAss } from "./formats/ass";
import { parseSubtitles, serializeSubtitles, detectFormat, convertDoc } from "./formats";
import { parseTimestamp, formatTimestamp, formatAssTime, cps, visibleText } from "./cue";

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

const ASS_GOLDEN = [
  "[Script Info]",
  "; A comment",
  "Title: Test",
  "ScriptType: v4.00+",
  "",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, Alignment, Encoding",
  "Style: Default,Arial,72,&H00FFFFFF,2,1",
  "Style: Title,Arial,90,&H0000FFFF,8,1",
  "",
  "[Events]",
  "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  "Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Hello, world",
  "Comment: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,commented out",
  "Dialogue: 0,0:00:05.50,0:00:08.20,Title,,0,0,0,,{\\i1}Styled{\\i0} line",
].join("\n");

describe("ASS", () => {
  it("parses dialogue and comment cues, times, style and text with commas", () => {
    const doc = parseAss(ASS_GOLDEN);
    expect(doc.cues).toHaveLength(3); // Dialogue + Comment + Dialogue
    expect(doc.cues[0].startMs).toBe(1000);
    expect(doc.cues[0].endMs).toBe(4000);
    expect(doc.cues[0].text).toBe("Hello, world");
    expect(doc.cues[0].assKind).toBe("Dialogue");
    expect(doc.cues[0].assFields?.Style).toBe("Default");
    expect(doc.cues[1].assKind).toBe("Comment");
    expect(doc.cues[1].text).toBe("commented out");
    expect(doc.cues[2].startMs).toBe(5500);
    expect(doc.cues[2].endMs).toBe(8200);
    expect(doc.cues[2].text).toBe("{\\i1}Styled{\\i0} line");
    expect(doc.cues[2].assFields?.Style).toBe("Title");
  });
  it("gives a style-less cue a real style on write (empty Style would not render)", () => {
    const doc = parseAss(ASS_GOLDEN);
    doc.cues.push({ id: "new", startMs: 0, endMs: 2000, text: "test" }); // no assFields
    const line = serializeAss(doc)
      .split(/\r?\n/)
      .find((l) => l.endsWith(",test"))!;
    // Format is Layer,Start,End,Style,Name,... so Style is the 4th comma-separated field.
    const style = line.replace(/^Dialogue:\s*/, "").split(",")[3];
    expect(style).toBe("Default"); // falls back to the first defined style, not empty
  });
  it("collects styles for the editor and picker", () => {
    const doc = parseAss(ASS_GOLDEN);
    expect(doc.styles?.map((s) => s.name)).toEqual(["Default", "Title"]);
    expect(doc.styles?.[0].fields.Fontsize).toBe("72");
    expect(doc.styles?.[1].fields.Fontsize).toBe("90");
  });
  it("round-trips a Comment line as a disabled cue", () => {
    const doc = parseAss(ASS_GOLDEN);
    expect(doc.cues[1].assKind).toBe("Comment");
    expect(serializeAss(doc)).toContain("Comment: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,commented out");
  });
  it("round-trips byte-for-byte", () => {
    expect(serializeAss(parseAss(ASS_GOLDEN))).toBe(ASS_GOLDEN);
  });
  it("preserves CRLF and BOM", () => {
    const crlf = ASS_GOLDEN.replace(/\n/g, "\r\n");
    expect(serializeAss(parseAss(crlf))).toBe(crlf);
    const bom = "﻿" + ASS_GOLDEN;
    expect(serializeAss(parseAss(bom))).toBe(bom);
  });
  it("re-emits only the edited dialogue line, keeping the rest", () => {
    const doc = parseAss(ASS_GOLDEN);
    doc.cues[0].endMs = 4500;
    const out = serializeAss(doc);
    expect(out).toContain("0:00:01.00,0:00:04.50,Default");
    expect(out).toContain("commented out"); // untouched
    expect(out).toContain("{\\i1}Styled{\\i0} line"); // untouched
  });
  it("formats ASS timestamps at centisecond precision", () => {
    expect(formatAssTime(1000)).toBe("0:00:01.00");
    expect(formatAssTime(5500)).toBe("0:00:05.50");
    expect(formatAssTime(3661230)).toBe("1:01:01.23");
  });
  it("re-emits only the edited style, keeping the rest byte-exact", () => {
    const doc = parseAss(ASS_GOLDEN);
    doc.styles![0].fields.Fontsize = "80";
    const out = serializeAss(doc);
    expect(out).toContain("Style: Default,Arial,80,");
    expect(out).toContain("Style: Title,Arial,90,"); // untouched
    expect(out).toContain("Dialogue: 0,0:00:01.00,0:00:04.00,Default"); // events untouched
  });
});

describe("dispatch and conversion", () => {
  it("detects format from extension and content", () => {
    expect(detectFormat("x.vtt", "")).toBe("vtt");
    expect(detectFormat("x.srt", "")).toBe("srt");
    expect(detectFormat("x.ass", "")).toBe("ass");
    expect(detectFormat("x.ssa", "")).toBe("ass");
    expect(detectFormat(undefined, "WEBVTT\n\n...")).toBe("vtt");
    expect(detectFormat(undefined, "[Script Info]\nScriptType: v4.00+")).toBe("ass");
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
  it("converts SRT to ASS with a Default style scaffold", () => {
    const ass = convertDoc(parseSrt(SRT_GOLDEN), "ass");
    expect(ass.format).toBe("ass");
    expect(ass.styles?.map((s) => s.name)).toEqual(["Default"]);
    expect(ass.cues[0].assFields?.Style).toBe("Default");
    const out = serializeSubtitles(ass);
    expect(out).toContain("[Events]");
    expect(out).toContain("[V4+ Styles]");
    expect(out).toContain("Style: Default,");
    expect(out).toContain("Dialogue: 0,0:00:01.00,0:00:04.00,Default");
    // Multi-line SRT text becomes \N in ASS.
    expect(out).toContain("Second line one\\NSecond line two");
  });
  it("converts ASS to SRT stripping override tags", () => {
    const srt = convertDoc(parseAss(ASS_GOLDEN), "srt");
    expect(srt.format).toBe("srt");
    expect(srt.cues[1].text).toBe("Styled line"); // {\\i1}..{\\i0} removed
    expect(srt.cues[0].assFields).toBeUndefined();
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
