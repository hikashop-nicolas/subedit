// Loading the generated corpus, and working out what each fixture's format can actually be
// expected to give back.
//
// Shared by the read and preservation checks so there is one statement of "what this format
// can carry" rather than one per test drifting apart. Everything here describes a format's
// nature, never a defect: nothing in this file exists to make a failing check pass.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SubtitleFormat } from "../cue";

export const CORPUS_DIR = new URL("../../test-corpus/", import.meta.url).pathname;

export type TruthCue = { start: number; end: number; text: string };

export type Fixture = {
  name: string;
  format: SubtitleFormat;
  set?: "base" | "fine" | "overlap";
  variant?: string;
  author: "hand" | "ffmpeg";
  oracle: { kind: string; id?: string; blind?: string } | null;
  carries?: { ends?: boolean; lineBreaks?: boolean };
  cues: number;
};

const readJson = <T,>(name: string): T => JSON.parse(readFileSync(join(CORPUS_DIR, name), "utf8")) as T;

export const manifest: Fixture[] = readJson<Fixture[]>("manifest.json");
const truth = readJson<{ base: TruthCue[]; fine: TruthCue[]; overlap: TruthCue[]; fps: number }>("truth.json");

export const CORPUS_FPS = truth.fps;

export function fixtureText(fx: Fixture): string {
  return readFileSync(join(CORPUS_DIR, fx.name), "utf8");
}

/**
 * The cues this fixture should yield: the ground truth, adjusted for what its format stores.
 *
 * Both adjustments are the format's definition rather than an allowance:
 *   - LRC timestamps a line, not a cue, so a two-line cue is two entries sharing a start.
 *   - LRC and TMPlayer store no end at all; a cue runs until the next one begins, and the
 *     last runs for a fixed tail. Ends are checked against that rule instead of the truth.
 */
export function expectedCues(fx: Fixture): TruthCue[] {
  let cues = truth[fx.set ?? "base"];
  if (fx.carries?.lineBreaks === false) {
    cues = cues.flatMap((c) => c.text.split("\n").map((line) => ({ ...c, text: line })));
    cues = cues.map((c, i) => ({ ...c, end: i + 1 < cues.length ? cues[i + 1].start : c.end }));
  }
  return cues;
}

/**
 * The text as this format stores it, which is not always the text as it reads.
 *
 * subedit keeps the text of a byte-preserved format exactly as the file spells it, and only
 * the formats it regenerates (TTML, SAMI, TTXT, the JSON ones) hold decoded text. So an ASS
 * cue arrives with "\N" where the line break is, and a WebVTT cue arrives with "&amp;" still
 * written out. Both are the intended model, not a shortfall, and this function encodes that
 * rather than letting each test invent its own idea of it.
 */
export function expectedText(fx: Fixture, text: string): string {
  if (fx.format === "ass") return text.replace(/\n/g, "\\N");
  if (fx.format === "vtt") return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text;
}
