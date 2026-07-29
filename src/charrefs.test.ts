// Character references, in both directions.
//
// These live in their own file because the rule is not "escape the special characters": in
// WebVTT the same "<" is markup in one place and a literal in another, and the corpus checks
// caught both halves of getting that wrong. A stricter ffmpeg on CI than the one here rejected
// a bare ">" that the local build had tolerated, which is how the ">" case got written down.

import { describe, expect, it } from "vitest";
import { decodeCharRefs, encodeCharRefs, visibleText } from "./cue";

describe("decoding", () => {
  it("resolves the six references WebVTT defines", () => {
    expect(decodeCharRefs("a &amp; b &lt;c&gt; d")).toBe("a & b <c> d");
    expect(decodeCharRefs("&nbsp;")).toBe(" ");
    expect(decodeCharRefs("&lrm;&rlm;")).toBe("‎‏");
  });

  it("leaves anything else alone", () => {
    expect(decodeCharRefs("&copy; &#233; &notareference;")).toBe("&copy; &#233; &notareference;");
  });
});

describe("encoding", () => {
  it("escapes bare angle brackets and ampersands", () => {
    expect(encodeCharRefs('5 > 3 & 2 < 4')).toBe("5 &gt; 3 &amp; 2 &lt; 4");
  });

  it("keeps the tags WebVTT understands", () => {
    expect(encodeCharRefs("<i>slanted</i>")).toBe("<i>slanted</i>");
    expect(encodeCharRefs("<c.yellow>tinted</c>")).toBe("<c.yellow>tinted</c>");
    expect(encodeCharRefs("<v Bob>who said it")).toBe("<v Bob>who said it");
    expect(encodeCharRefs("<00:01.000>karaoke")).toBe("<00:01.000>karaoke");
  });

  it("does not double-escape a reference that is already there", () => {
    expect(encodeCharRefs("a &amp; b")).toBe("a &amp; b");
    expect(encodeCharRefs(encodeCharRefs("a & b"))).toBe("a &amp; b");
  });

  it("round-trips", () => {
    for (const s of ['5 > 3 & 2 < 4', "<i>x</i> & y", "plain", "a < b", "100% & <b>bold</b>"]) {
      expect(decodeCharRefs(encodeCharRefs(s)), s).toBe(s);
    }
  });
});

describe("counting", () => {
  it("counts a reference as the one character it stands for", () => {
    // Five characters of "&amp;" would push a cue over the reading-speed warning on its own.
    expect(visibleText("a &amp; b")).toBe("a & b");
    expect(visibleText("a &amp; b")).toHaveLength(5);
  });

  it("strips tags before resolving references, so a literal cannot eat the text after it", () => {
    // Resolve first and "&lt;" becomes a "<" that the tag pattern then runs over, swallowing
    // everything up to the next ">".
    expect(visibleText("5 &lt; 4 &gt; 3")).toBe("5 < 4 > 3");
  });
});
