import { describe, it, expect } from "vitest";
import { parseMicroDvd, serializeMicroDvd } from "./formats/microdvd";
import { parseLrc, serializeLrc } from "./formats/lrc";
import { parseTtml, serializeTtml } from "./formats/ttml";
import { parseSubtitles, detectFormat } from "./formats";

describe("MicroDVD (.sub)", () => {
  const SUB = ["{1}{1}25", "{25}{75}Hello, world.", "{100}{150}Line one|Line two"].join("\n");

  it("round-trips a well-formed file frame-exactly", () => {
    expect(serializeMicroDvd(parseMicroDvd(SUB))).toBe(SUB);
  });

  it("converts frames to time with the declared fps", () => {
    const doc = parseMicroDvd(SUB);
    expect(doc.fps).toBe(25);
    expect(doc.cues[0].startMs).toBe(1000); // 25 frames / 25 fps = 1s
    expect(doc.cues[0].endMs).toBe(3000); // 75 / 25 = 3s
    expect(doc.cues[1].text).toBe("Line one\nLine two"); // '|' becomes newline
  });

  it("omits the fps line when the source had none", () => {
    const out = serializeMicroDvd(parseMicroDvd("{24}{48}Hi"));
    expect(out.startsWith("{1}{1}")).toBe(false);
  });

  it("is detected by extension and by content", () => {
    expect(detectFormat("x.sub", "")).toBe("sub");
    expect(detectFormat(undefined, "{0}{50}Hi")).toBe("sub");
  });
});

describe("LRC", () => {
  const LRC = ["[ar:Artist]", "[ti:Title]", "[00:01.00]First line", "[00:03.50]Second line"].join("\n");

  it("parses metadata, timestamps and implicit end times", () => {
    const doc = parseLrc(LRC);
    expect(doc.header).toContain("[ar:Artist]");
    expect(doc.cues).toHaveLength(2);
    expect(doc.cues[0].startMs).toBe(1000);
    expect(doc.cues[0].endMs).toBe(3500); // end = next line's start
    expect(doc.cues[0].text).toBe("First line");
  });

  it("serializes starts and metadata (round-trips the timed lines)", () => {
    const out = serializeLrc(parseLrc(LRC));
    expect(out).toContain("[ar:Artist]");
    expect(out).toContain("[00:01.00]First line");
    expect(out).toContain("[00:03.50]Second line");
  });

  it("is detected by extension and by content", () => {
    expect(detectFormat("song.lrc", "")).toBe("lrc");
    expect(detectFormat(undefined, "[00:01.00]Hi")).toBe("lrc");
  });
});

describe("TTML / DFXP", () => {
  const TTML = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en">',
    "  <body><div>",
    '    <p begin="00:00:01.000" end="00:00:03.500">Hello, world.</p>',
    '    <p begin="4s" end="00:00:07.000">Line one<br/>Line two</p>',
    "  </div></body>",
    "</tt>",
  ].join("\n");

  it("parses <p> cues with clock and offset times and <br/> breaks", () => {
    const doc = parseTtml(TTML);
    expect(doc.cues).toHaveLength(2);
    expect(doc.cues[0].startMs).toBe(1000);
    expect(doc.cues[0].endMs).toBe(3500);
    expect(doc.cues[1].startMs).toBe(4000); // "4s" offset
    expect(doc.cues[1].text).toBe("Line one\nLine two");
    expect(doc.header).toBe("en");
  });

  it("re-imports its own output consistently", () => {
    const a = parseTtml(TTML);
    const b = parseTtml(serializeTtml(a));
    expect(b.cues.map((c) => [c.startMs, c.endMs, c.text])).toEqual(a.cues.map((c) => [c.startMs, c.endMs, c.text]));
  });

  it("is detected by extension and by content", () => {
    expect(detectFormat("x.ttml", "")).toBe("ttml");
    expect(detectFormat("x.dfxp", "")).toBe("ttml");
    expect(detectFormat(undefined, '<tt xmlns="...">')).toBe("ttml");
  });
});

describe("dispatch", () => {
  it("routes each format through parseSubtitles by extension", () => {
    expect(parseSubtitles("{0}{25}Hi", "a.sub").format).toBe("sub");
    expect(parseSubtitles("[00:01.00]Hi", "a.lrc").format).toBe("lrc");
    expect(parseSubtitles('<tt><body><div><p begin="1s">Hi</p></div></body></tt>', "a.ttml").format).toBe("ttml");
  });
});
