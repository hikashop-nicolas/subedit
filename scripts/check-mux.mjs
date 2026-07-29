#!/usr/bin/env node
// Do the containers subedit writes actually hold the subtitle tracks it thinks they do?
//
// "Save into the video" has the most to lose here: it writes a media container, and until now
// the only thing that ever read one back was subedit itself, by searching the bytes for ASCII
// markers. That shows the strings are somewhere in the file. It does not show the container is
// well-formed, that the tracks are declared, or that the cues survived.
//
// ffmpeg is used for the tracks it can read, and only those. Two it cannot, and the difference
// between "ffmpeg will not read this" and "this file is broken" is the whole point of the
// exercise, so it is written down rather than assumed either way:
//
//   - WebVTT in MP4 (ISO/IEC 14496-30, a `wvtt` sample entry). libavformat contains no
//     occurrence of "wvtt" at all: ffmpeg has never demuxed it, and reports the track as
//     `data`. mediabunny's output carries the wvtt entry and its vttC config box, so the file
//     looks right; ffmpeg is simply not a reader for it. Checked structurally below.
//   - WebVTT in Matroska. mediabunny writes the codec ID `S_TEXT/WEBVTT`; libavformat knows
//     only the `D_WEBVTT/*` family, so ffmpeg reports no codec for the track and cannot
//     extract it. Also checked structurally, and worth knowing about: whatever the registry
//     says, a track ffmpeg cannot identify is one a great many players cannot show.
//
// The ASS-in-MKV track, which is the one subedit's fork of mediabunny exists to produce, ffmpeg
// reads perfectly, so that one is compared cue by cue against the ground truth.
//
// Run after `vitest run src/corpus/mux-corpus.test.ts`.
// Usage: node scripts/check-mux.mjs

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeText, parseSrtBack } from "./oracles.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const WRITTEN = join(ROOT, ".cache/written/containers");
const CORPUS = join(ROOT, "test-corpus");

// `readable` says whether ffmpeg can decode this track's codec; only those get a cue-by-cue
// comparison. Languages are the ISO 639-2/T codes mux.ts maps to, and they are checked because
// a track a player cannot identify is a track a viewer cannot choose.
const EXPECTED = [
  {
    file: "muxed.mkv",
    what: "MKV",
    video: 1,
    audio: 1,
    subtitles: [
      { codec: "ass", language: "eng", title: "Styled", readable: true },
      { codec: null, language: "fra", title: "Plain", readable: false, marker: "S_TEXT/WEBVTT" },
    ],
  },
  {
    file: "muxed.mp4",
    what: "MP4",
    video: 1,
    audio: 1,
    // ffprobe sees this as a data track, so it is not counted among the subtitle streams.
    subtitles: [],
    boxes: ["wvtt", "vttC"],
  },
];

const ffprobe = (args) =>
  execFileSync("ffprobe", ["-v", "error", ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

function main() {
  if (!existsSync(WRITTEN)) {
    console.error("No output directory: run `vitest run src/corpus/mux-corpus.test.ts` first.");
    process.exit(1);
  }
  const truth = JSON.parse(readFileSync(join(CORPUS, "truth.json"), "utf8")).base;

  const failures = [];
  for (const spec of EXPECTED) {
    const path = join(WRITTEN, spec.file);
    if (!existsSync(path)) {
      failures.push(`${spec.what}: subedit wrote no ${spec.file}`);
      continue;
    }
    failures.push(...check(path, spec, truth).map((f) => `${spec.what}: ${f}`));
  }

  if (failures.length) {
    console.error("\nffprobe disagreed with what subedit muxed:\n");
    for (const f of failures) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }
  console.log("Both muxed containers open, keep their video and audio, and carry their subtitle tracks.");
}

function check(path, spec, truth) {
  const failures = [];

  let streams;
  try {
    streams = JSON.parse(
      ffprobe(["-show_streams", "-show_entries", "stream=index,codec_type,codec_name:stream_tags=language,title", "-of", "json", path]),
    ).streams;
  } catch (e) {
    // A container ffprobe cannot open at all is the loudest failure available: subedit
    // produced something only subedit can read.
    return [`ffprobe could not open it: ${String(e.stderr ?? e.message ?? e).trim().split("\n")[0]}`];
  }

  const of = (type) => streams.filter((s) => s.codec_type === type);
  if (of("video").length !== spec.video) failures.push(`${of("video").length} video tracks, expected ${spec.video}`);
  if (of("audio").length !== spec.audio) failures.push(`${of("audio").length} audio tracks, expected ${spec.audio}`);
  // The stream-copy must not have quietly re-encoded or dropped anything.
  if (of("video")[0] && of("video")[0].codec_name !== "h264") failures.push(`video is ${of("video")[0].codec_name}, expected the source's h264 copied through`);
  if (of("audio")[0] && of("audio")[0].codec_name !== "aac") failures.push(`audio is ${of("audio")[0].codec_name}, expected the source's aac copied through`);

  const subs = of("subtitle");
  if (subs.length !== spec.subtitles.length) {
    failures.push(`${subs.length} subtitle tracks, expected ${spec.subtitles.length}`);
    return failures; // pairing them up past this point says nothing useful
  }

  for (let i = 0; i < subs.length; i++) {
    const [want, got] = [spec.subtitles[i], subs[i]];
    const tags = got.tags ?? {};
    if (want.codec && got.codec_name !== want.codec) failures.push(`subtitle track ${i + 1} is ${got.codec_name}, expected ${want.codec}`);
    if (tags.language !== want.language) failures.push(`subtitle track ${i + 1} is tagged "${tags.language}", expected "${want.language}"`);
    if (want.title && tags.title !== want.title) failures.push(`subtitle track ${i + 1} is named "${tags.title}", expected "${want.title}"`);

    if (want.readable) failures.push(...compareCues(path, got.index, i + 1, truth));
    else if (want.marker) failures.push(...checkMarker(path, want.marker, `subtitle track ${i + 1}`));
  }

  // Files whose subtitle track ffmpeg does not recognise at all still have to look right.
  for (const box of spec.boxes ?? []) failures.push(...checkMarker(path, box, `the ${box} box`));
  return failures;
}

/** Pull one subtitle track out as SRT and check the cues are the ones that went in. */
function compareCues(path, streamIndex, label, truth) {
  let got;
  try {
    const srt = execFileSync(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-i", path, "-map", `0:${streamIndex}`, "-f", "srt", "-"],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    got = parseSrtBack(srt);
  } catch (e) {
    return [`subtitle track ${label} could not be extracted: ${String(e.stderr ?? e.message ?? e).trim().split("\n")[0]}`];
  }

  if (got.length !== truth.length) return [`subtitle track ${label} has ${got.length} cues, expected ${truth.length}`];
  for (let i = 0; i < truth.length; i++) {
    const [w, h] = [truth[i], got[i]];
    if (h.start !== w.start) return [`subtitle track ${label} cue ${i + 1} starts at ${h.start} ms, expected ${w.start}`];
    if (h.end !== w.end) return [`subtitle track ${label} cue ${i + 1} ends at ${h.end} ms, expected ${w.end}`];
    if (normalizeText(h.text) !== normalizeText(w.text)) {
      return [`subtitle track ${label} cue ${i + 1} text is ${JSON.stringify(h.text)}, expected ${JSON.stringify(w.text)}`];
    }
  }
  return [];
}

/**
 * A byte-level check, for the tracks no reader here can open.
 *
 * Weaker than reading the cues back and named as such: it shows the container declares the
 * codec or carries the box, not that the payload is right. It is what is available.
 */
function checkMarker(path, marker, label) {
  const raw = readFileSync(path).toString("latin1");
  return raw.includes(marker) ? [] : [`${label}: no "${marker}" anywhere in the file`];
}

main();
