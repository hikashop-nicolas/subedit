import { it, expect } from "vitest";
import { Output, BufferTarget, MkvOutputFormat, TextSubtitleSource } from "mediabunny";

// Styled ASS-in-MKV muxing is the reason subedit consumes a fork of mediabunny rather than
// the published package (the change is upstream PR #443, still open). Nothing else in this
// suite exercises it, so a fork rebase could silently take it away and every other test
// would still pass. This asserts the one thing the fork is for.
//
// It drives mediabunny directly rather than going through mux.ts, because mux.ts needs a
// real media file to stream-copy; the subtitle track is what is at stake here.

const ASS = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,48

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello styled world
`;

it("writes a styled ASS subtitle track into an MKV", async () => {
  const target = new BufferTarget();
  const output = new Output({ format: new MkvOutputFormat(), target });
  const source = new TextSubtitleSource("ass");
  output.addSubtitleTrack(source, { language: "eng" });
  await output.start();
  await source.add(ASS);
  await output.finalize();

  const bytes = new Uint8Array(target.buffer as ArrayBuffer);
  // latin1 so byte values survive the decode: we are looking for ASCII markers inside a
  // binary container, not decoding real text.
  const raw = new TextDecoder("latin1").decode(bytes);

  expect(bytes.length).toBeGreaterThan(100);
  // The codec id, which is what the fork adds. Without it the track would be S_TEXT/UTF8
  // and the styling would be gone.
  expect(raw).toContain("S_TEXT/ASS");
  // The style header travels as CodecPrivate, and the dialogue as the cue payload.
  expect(raw).toContain("Hello styled world");
  expect(raw).toContain("[V4+ Styles]");
});
