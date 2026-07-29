// Mux subtitle tracks into a real container, for scripts/check-mux.mjs to inspect.
//
// "Save into the video" is the feature with the most to lose and the least cover: it writes a
// media container, and the only thing that has ever read one back is subedit itself, by
// searching the bytes for ASCII markers. That shows the strings are in there. It does not show
// the container is well-formed, that a player would find the track, or that the cues survived.
//
// So this writes real files and scripts/check-mux.mjs hands them to ffprobe and ffmpeg.

import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { muxIntoContainer, type MuxSubtitle } from "../mux";
import { convertDoc, parseSubtitles, serializeSubtitles } from "../formats/index";
import { CORPUS_DIR, fixtureText, manifest } from "./fixtures";

// Its own directory, wiped once here, for the same reason write-corpus.test.ts has one.
const OUT = new URL("../../.cache/written/containers/", import.meta.url).pathname;

describe("muxing subtitles into a container", () => {
  const source = manifest.find((m) => m.name === "base.srt")!;
  const media = new Uint8Array(readFileSync(join(CORPUS_DIR, "tiny.mp4")));

  /** The corpus cues, as the subtitle document of the given kind that mux.ts expects. */
  function track(kind: "ass" | "vtt", name: string, language: string): MuxSubtitle {
    const doc = convertDoc(parseSubtitles(fixtureText(source), source.name), kind === "ass" ? "ass" : "vtt");
    return { name, language, kind, content: serializeSubtitles(doc) };
  }

  it("writes an MKV carrying a styled ASS track and a WebVTT track", async () => {
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
    const out = await muxIntoContainer(media, [track("ass", "Styled", "en"), track("vtt", "Plain", "fr")], "mkv");
    expect(out.byteLength, "the muxer produced nothing").toBeGreaterThan(media.byteLength);
    writeFileSync(join(OUT, "muxed.mkv"), out);
  }, 30_000);

  it("writes an MP4 carrying a WebVTT track", async () => {
    mkdirSync(OUT, { recursive: true });
    const out = await muxIntoContainer(media, [track("vtt", "Plain", "en")], "mp4");
    expect(out.byteLength).toBeGreaterThan(media.byteLength);
    writeFileSync(join(OUT, "muxed.mp4"), out);
  }, 30_000);
});
