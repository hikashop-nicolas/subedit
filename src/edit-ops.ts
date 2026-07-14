// Pure cue-list editing operations, factored out of the editor so they can be unit-tested
// without a DOM. Each takes plain data and returns new data (no mutation of the input array).

import { type Cue, type SubtitleFormat, blankCue, cps } from "./cue";

// Merge the cue at index i with the one after it: join their text with a space, span the
// combined time, and drop the second cue. Returns a new array, or null if there's no next cue.
export function mergeCuesAt(cues: Cue[], i: number): Cue[] | null {
  const cur = cues[i];
  const next = cues[i + 1];
  if (!cur || !next) return null;
  const merged: Cue = {
    ...cur,
    text: `${cur.text.trimEnd()} ${next.text.trimStart()}`.trim(),
    endMs: Math.max(cur.endMs, next.endMs),
  };
  const out = cues.slice();
  out.splice(i, 2, merged);
  return out;
}

// Split the cue at index i at character offset `at` (clamped to a sensible midpoint), dividing
// the duration in proportion to each part's length. ASS style/fields carry to the second cue.
// Returns the new array plus the two resulting ids, or null if the cue can't be split.
export function splitCueAt(
  cues: Cue[],
  i: number,
  at: number,
  format: SubtitleFormat,
): { cues: Cue[]; firstId: string; secondId: string } | null {
  const cue = cues[i];
  if (!cue) return null;
  const text = cue.text;
  let pos = at;
  if (pos <= 0 || pos >= text.length) pos = Math.floor(text.length / 2);
  if (pos <= 0) return null;
  const first = text.slice(0, pos).trimEnd();
  const rest = text.slice(pos).trimStart();
  const total = cue.endMs - cue.startMs;
  const frac = first.length / Math.max(1, first.length + rest.length);
  const mid = cue.startMs + Math.max(1, Math.min(total - 1, Math.round(total * frac)));
  const second = blankCue(mid, cue.endMs, rest);
  if (format === "ass") {
    second.assKind = cue.assKind;
    if (cue.assFields) second.assFields = { ...cue.assFields };
  }
  const firstCue: Cue = { ...cue, text: first, endMs: mid };
  const out = cues.slice();
  out.splice(i, 1, firstCue, second);
  return { cues: out, firstId: firstCue.id, secondId: second.id };
}

// Clamp a timing edge to the playhead, keeping at least a 1ms span against the other edge.
export function clampStart(cue: Cue, ms: number): number {
  return Math.min(ms, cue.endMs - 1);
}
export function clampEnd(cue: Cue, ms: number): number {
  return Math.max(ms, cue.startMs + 1);
}

export type ProblemKind = "overlap" | "tooFast" | "tooLong";
export interface Problem {
  id: string;
  index: number;
  kind: ProblemKind;
  cps?: number;
}

// Detect the common subtitle issues: overlap with the next cue, too-fast reading speed, and
// over-long duration. In document order, each with its cue's id/index for jumping.
export function findProblems(cues: Cue[], opts: { cpsBad: number; maxDurMs: number }): Problem[] {
  const out: Problem[] = [];
  for (let i = 0; i < cues.length; i += 1) {
    const c = cues[i];
    const next = cues[i + 1];
    if (next && c.endMs > next.startMs) out.push({ id: c.id, index: i, kind: "overlap" });
    const speed = cps(c);
    if (speed > opts.cpsBad) out.push({ id: c.id, index: i, kind: "tooFast", cps: speed });
    if (c.endMs - c.startMs > opts.maxDurMs) out.push({ id: c.id, index: i, kind: "tooLong" });
  }
  return out;
}

// Ids of the cues whose text contains `query` (case-insensitive); empty for an empty query.
export function matchCues(cues: Cue[], query: string): string[] {
  const q = query.toLowerCase();
  return q ? cues.filter((c) => c.text.toLowerCase().includes(q)).map((c) => c.id) : [];
}

// Replace every case-insensitive occurrence of `query` with `replacement` across all cues,
// mutating each matching cue's text in place. Returns how many cues changed.
export function replaceAllInCues(cues: Cue[], query: string, replacement: string): number {
  if (!query) return 0;
  const rx = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  let n = 0;
  for (const c of cues) {
    const next = c.text.replace(rx, replacement);
    if (next !== c.text) {
      c.text = next;
      n += 1;
    }
  }
  return n;
}
