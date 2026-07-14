import { describe, it, expect } from "vitest";
import { parseTmp, serializeTmp } from "./tmp";
import { parseCsvSubs, serializeCsvSubs } from "./csv";
import { parseQtText, serializeQtText } from "./qttext";
import { parseDvdStudio, serializeDvdStudio } from "./dvdsp";
import { parseJsonSubs, serializeJsonSubs } from "./jsonsub";
import { parseTtxt, serializeTtxt } from "./ttxt";
import { detectFormat } from "./index";

describe("TMPlayer", () => {
  const TMP = ["00:00:01:Hello|world", "00:00:04:Next"].join("\n");
  it("parses start-only times, ends at the next line", () => {
    const doc = parseTmp(TMP);
    expect(doc.cues[0].startMs).toBe(1000);
    expect(doc.cues[0].endMs).toBe(4000);
    expect(doc.cues[0].text).toBe("Hello\nworld");
    expect(serializeTmp(doc)).toBe(TMP);
  });
  it("detects by content (and not a frame-timecode line)", () => {
    expect(detectFormat(undefined, "00:00:01:Hi")).toBe("tmp");
    expect(detectFormat(undefined, "00:00:01:00,00:00:03:00,Hi")).toBe("spruce");
  });
});

describe("CSV", () => {
  it("round-trips through a Start,End,Text file with quoting", () => {
    const doc = parseCsvSubs('Start,End,Text\n00:00:01.000,00:00:03.500,"Hello, ""world"""');
    expect(doc.cues[0].startMs).toBe(1000);
    expect(doc.cues[0].endMs).toBe(3500);
    expect(doc.cues[0].text).toBe('Hello, "world"');
    const out = serializeCsvSubs(doc);
    expect(out.split("\n")[0]).toBe("Start,End,Text");
    expect(out).toContain('"Hello, ""world"""');
  });
  it("detects by extension", () => {
    expect(detectFormat("x.csv", "")).toBe("csv");
  });
});

describe("QuickTime Text", () => {
  const QT = ["{QTtext}{timeScale:100}", "[00:00:01.00]", "Hello", "[00:00:03.50]", "", "[00:00:04.00]", "Next", "[00:00:07.00]"].join("\n");
  it("parses markers and spans", () => {
    const doc = parseQtText(QT);
    expect(doc.cues).toHaveLength(2);
    expect(doc.cues[0].startMs).toBe(1000);
    expect(doc.cues[0].endMs).toBe(3500);
    expect(doc.cues[0].text).toBe("Hello");
  });
  it("detects the {QTtext} header", () => {
    expect(detectFormat(undefined, "{QTtext}{...}\n[00:00:00.00]")).toBe("qttext");
  });
});

describe("DVD Studio Pro", () => {
  const DVD = ["$FPS = 25", "00:00:01:00 , 00:00:03:12 , Hello|world"].join("\n");
  it("parses spaced frame timecodes with fps", () => {
    const doc = parseDvdStudio(DVD);
    expect(doc.cues[0].startMs).toBe(1000);
    expect(doc.cues[0].endMs).toBe(3000 + Math.round((12 / 25) * 1000));
    expect(doc.cues[0].text).toBe("Hello\nworld");
    expect(serializeDvdStudio(doc)).toBe(DVD);
  });
  it("detects the spaced form (distinct from Spruce)", () => {
    expect(detectFormat(undefined, "00:00:01:00 , 00:00:03:12 , Hi")).toBe("dvdsp");
  });
});

describe("Generic JSON", () => {
  it("round-trips start/end/text (ms)", () => {
    const doc = parseJsonSubs('[{"start":1000,"end":3500,"text":"Hi"}]');
    expect(doc.cues[0].startMs).toBe(1000);
    expect(doc.cues[0].endMs).toBe(3500);
    expect(JSON.parse(serializeJsonSubs(doc))).toEqual([{ start: 1000, end: 3500, text: "Hi" }]);
  });
  it("accepts startMs/endMs aliases", () => {
    expect(parseJsonSubs('[{"startMs":500,"endMs":800,"text":"x"}]').cues[0].startMs).toBe(500);
  });
  it("detects a subtitle array but not YouTube json", () => {
    expect(detectFormat(undefined, '[{"start":0,"end":1,"text":"x"}]')).toBe("jsonsub");
    expect(detectFormat(undefined, '{"events":[{"tStartMs":0}]}')).toBe("ytjson");
  });
});

describe("TTXT", () => {
  const TTXT = [
    '<?xml version="1.0"?>',
    '<TextStream version="1.1">',
    '<TextSample sampleTime="00:00:01.000" text="Hello world"/>',
    '<TextSample sampleTime="00:00:03.500" text=""/>',
    "</TextStream>",
  ].join("\n");
  it("parses samples with empty-text clears", () => {
    const doc = parseTtxt(TTXT);
    expect(doc.cues).toHaveLength(1);
    expect(doc.cues[0].startMs).toBe(1000);
    expect(doc.cues[0].endMs).toBe(3500);
    expect(doc.cues[0].text).toBe("Hello world");
  });
  it("re-imports its own output", () => {
    const a = parseTtxt(TTXT);
    const b = parseTtxt(serializeTtxt(a));
    expect(b.cues.map((c) => [c.startMs, c.endMs, c.text])).toEqual(a.cues.map((c) => [c.startMs, c.endMs, c.text]));
  });
  it("detects TextStream", () => {
    expect(detectFormat("x.ttxt", "")).toBe("ttxt");
    expect(detectFormat(undefined, '<TextStream version="1.1">')).toBe("ttxt");
  });
});
