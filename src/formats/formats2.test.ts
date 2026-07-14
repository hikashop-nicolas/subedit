import { describe, it, expect } from "vitest";
import { parseSbv, serializeSbv } from "./sbv";
import { parseMpl2, serializeMpl2 } from "./mpl2";
import { parseSubViewer, serializeSubViewer } from "./subviewer";
import { parseSami, serializeSami } from "./sami";
import { parseYtJson, serializeYtJson } from "./youtube";
import { parseSpruce, serializeSpruce } from "./spruce";
import { parseSubtitles, detectFormat } from "./index";

describe("SBV", () => {
  const SBV = ["0:00:01.000,0:00:03.500", "Hello, world.", "", "0:00:04.000,0:00:07.000", "Line one", "Line two"].join("\n");
  it("round-trips and parses times", () => {
    const doc = parseSbv(SBV);
    expect(doc.cues).toHaveLength(2);
    expect(doc.cues[0].startMs).toBe(1000);
    expect(doc.cues[0].endMs).toBe(3500);
    expect(doc.cues[1].text).toBe("Line one\nLine two");
    expect(serializeSbv(doc)).toBe(SBV);
  });
  it("detects by extension and content", () => {
    expect(detectFormat("x.sbv", "")).toBe("sbv");
    expect(detectFormat(undefined, "0:00:01.000,0:00:03.500\nHi")).toBe("sbv");
  });
});

describe("MPL2", () => {
  const MPL = "[10][35]Hello|world\n[40][70]Next";
  it("round-trips deciseconds and | breaks", () => {
    const doc = parseMpl2(MPL);
    expect(doc.cues[0].startMs).toBe(1000);
    expect(doc.cues[0].endMs).toBe(3500);
    expect(doc.cues[0].text).toBe("Hello\nworld");
    expect(serializeMpl2(doc)).toBe(MPL);
  });
  it("detects by content", () => {
    expect(detectFormat(undefined, "[10][35]Hi")).toBe("mpl2");
  });
});

describe("SubViewer 2.0", () => {
  const SV = ["[INFORMATION]", "[TITLE]Demo", "[END INFORMATION]", "", "00:00:01.00,00:00:03.50", "Hello[br]world"].join("\n");
  it("keeps the header, parses centiseconds and [br]", () => {
    const doc = parseSubViewer(SV);
    expect(doc.header).toContain("[TITLE]Demo");
    expect(doc.cues[0].startMs).toBe(1000);
    expect(doc.cues[0].endMs).toBe(3500);
    expect(doc.cues[0].text).toBe("Hello\nworld");
  });
  it("re-serializes the timed line", () => {
    expect(serializeSubViewer(parseSubViewer(SV))).toContain("00:00:01.00,00:00:03.50");
  });
  it("a .sub with an [INFORMATION] header detects as SubViewer, not MicroDVD", () => {
    expect(detectFormat("x.sub", "[INFORMATION]\n[TITLE]t\n00:00:01.00,00:00:02.00\nHi")).toBe("subviewer");
    expect(detectFormat("x.sub", "{0}{25}Hi")).toBe("sub");
  });
});

describe("SAMI", () => {
  const SMI = '<SAMI><BODY><SYNC Start=1000><P Class=ENCC>Hello<br>world<SYNC Start=3500><P Class=ENCC>&nbsp;</BODY></SAMI>';
  it("parses SYNC markers, br breaks and clear markers", () => {
    const doc = parseSami(SMI);
    expect(doc.cues).toHaveLength(1);
    expect(doc.cues[0].startMs).toBe(1000);
    expect(doc.cues[0].endMs).toBe(3500); // the &nbsp; SYNC clears it
    expect(doc.cues[0].text).toBe("Hello\nworld");
  });
  it("re-imports its own output", () => {
    const a = parseSami(SMI);
    const b = parseSami(serializeSami(a));
    expect(b.cues.map((c) => [c.startMs, c.endMs, c.text])).toEqual(a.cues.map((c) => [c.startMs, c.endMs, c.text]));
  });
  it("detects by content", () => {
    expect(detectFormat(undefined, "<SAMI>\n<BODY>")).toBe("sami");
  });
});

describe("YouTube JSON", () => {
  const J = JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 2500, segs: [{ utf8: "Hello" }, { utf8: " world" }] }] });
  it("parses events into cues", () => {
    const doc = parseYtJson(J);
    expect(doc.cues[0].startMs).toBe(1000);
    expect(doc.cues[0].endMs).toBe(3500);
    expect(doc.cues[0].text).toBe("Hello world");
  });
  it("round-trips through its own serializer", () => {
    const b = parseYtJson(serializeYtJson(parseYtJson(J)));
    expect(b.cues.map((c) => [c.startMs, c.endMs, c.text])).toEqual([[1000, 3500, "Hello world"]]);
  });
  it("detects by content", () => {
    expect(detectFormat(undefined, '{"events":[{"tStartMs":0')).toBe("ytjson");
  });
});

describe("Spruce STL", () => {
  const STL = ["$FPS = 25", "00:00:01:00,00:00:03:12,Hello|world", "00:00:04:00,00:00:07:00,Next"].join("\n");
  it("reads fps, converts frames, keeps config header", () => {
    const doc = parseSpruce(STL);
    expect(doc.fps).toBe(25);
    expect(doc.header).toContain("$FPS = 25");
    expect(doc.cues[0].startMs).toBe(1000);
    expect(doc.cues[0].endMs).toBe(3000 + Math.round((12 / 25) * 1000)); // 12 frames @ 25fps
    expect(doc.cues[0].text).toBe("Hello\nworld");
    expect(serializeSpruce(doc)).toBe(STL);
  });
  it("detects by content", () => {
    expect(detectFormat(undefined, "00:00:01:00,00:00:03:12,Hi")).toBe("spruce");
  });
});

describe("dispatch", () => {
  it("routes each new format by extension", () => {
    expect(parseSubtitles("0:0:1.000,0:0:2.000\nHi", "a.sbv").format).toBe("sbv");
    expect(parseSubtitles("[10][20]Hi", "a.mpl").format).toBe("mpl2");
    expect(parseSubtitles("<SAMI><BODY><SYNC Start=0><P>Hi", "a.smi").format).toBe("sami");
    expect(parseSubtitles('{"events":[]}', "a.srv3").format).toBe("ytjson");
    expect(parseSubtitles("00:00:01:00,00:00:02:00,Hi", "a.stl").format).toBe("spruce");
  });
});
