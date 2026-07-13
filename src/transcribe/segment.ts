// Turn Whisper's timestamped tokens into readable subtitle cues. Pure and engine-agnostic
// (no browser APIs) so it is unit-testable and reusable. This is where subtitle quality
// lives: where lines break, how they wrap, and how timing is cleaned up.
import type { WordTs } from "./backend";

export interface SegmentOptions {
  maxCharsPerLine?: number; // wrap target per line
  maxLines?: number; // lines per cue
  maxCps?: number; // reading speed cap (characters per second)
  maxDurationMs?: number; // force a break past this length
  minDurationMs?: number; // stretch very short cues to at least this
  gapThresholdMs?: number; // a silence longer than this splits cues
  minGapMs?: number; // keep at least this gap between adjacent cues
  minSentenceChars?: number; // don't honour a sentence break below this length
}

export interface SegCue {
  startMs: number;
  endMs: number;
  text: string; // lines joined with "\n"
}

const DEFAULTS: Required<SegmentOptions> = {
  maxCharsPerLine: 42,
  maxLines: 2,
  maxCps: 20,
  maxDurationMs: 7000,
  minDurationMs: 1000,
  gapThresholdMs: 700,
  minGapMs: 120,
  minSentenceChars: 16,
};

const SENTENCE_END = /[.!?…。！？][)"'”』」]*$/;

function joinText(words: WordTs[]): string {
  return words.map((w) => w.text).join("").replace(/\s+/g, " ").trim();
}

// Break text into at most maxLines lines, balancing a two-line split and splitting CJK
// (spaceless) text by character count.
export function wrapLines(text: string, maxChars: number, maxLines: number): string {
  const t = text.trim();
  if (t.length <= maxChars || maxLines <= 1) return t;
  if (!/\s/.test(t)) {
    const lines = Math.min(maxLines, Math.ceil(t.length / maxChars));
    const per = Math.ceil(t.length / lines);
    const out: string[] = [];
    for (let i = 0; i < t.length; i += per) out.push(t.slice(i, i + per));
    return out.slice(0, maxLines).join("\n");
  }
  const words = t.split(/\s+/);
  if (maxLines === 2) {
    let best = -1;
    let bestScore = Infinity;
    for (let i = 1; i < words.length; i++) {
      const l1 = words.slice(0, i).join(" ").length;
      const l2 = words.slice(i).join(" ").length;
      const score = Math.max(l1, l2);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best > 0) return `${words.slice(0, best).join(" ")}\n${words.slice(best).join(" ")}`;
    return t;
  }
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cur && cand.length > maxChars) {
      out.push(cur);
      cur = w;
    } else cur = cand;
  }
  if (cur) out.push(cur);
  return out.join("\n");
}

// Split a single over-long unit (e.g. a whole-sentence chunk from a sentence-timestamp
// model) into cues sized to the box, distributing its time by character share.
function splitLongUnit(text: string, startMs: number, endMs: number, o: Required<SegmentOptions>): SegCue[] {
  const cap = o.maxCharsPerLine * o.maxLines;
  const t = text.trim();
  const pieces: string[] = [];
  if (/\s/.test(t)) {
    let cur = "";
    for (const w of t.split(/\s+/)) {
      const cand = cur ? `${cur} ${w}` : w;
      if (cur && cand.length > cap) {
        pieces.push(cur);
        cur = w;
      } else cur = cand;
    }
    if (cur) pieces.push(cur);
  } else {
    for (let i = 0; i < t.length; i += cap) pieces.push(t.slice(i, i + cap));
  }
  const total = pieces.reduce((a, p) => a + p.length, 0) || 1;
  const span = Math.max(1, endMs - startMs);
  let acc = startMs;
  return pieces.map((p, i) => {
    const s = Math.round(acc);
    acc += (p.length / total) * span;
    const e = i === pieces.length - 1 ? endMs : Math.round(acc);
    return { startMs: s, endMs: e, text: wrapLines(p, o.maxCharsPerLine, o.maxLines) };
  });
}

export function segmentToCues(words: WordTs[], opts: SegmentOptions = {}): SegCue[] {
  const o = { ...DEFAULTS, ...opts };
  const cap = o.maxCharsPerLine * o.maxLines;
  const list = words.filter((w) => w.text.trim() !== "" && w.endMs > w.startMs);
  if (!list.length) return [];

  // 1) group tokens into cue-sized runs
  const groups: WordTs[][] = [];
  let cur: WordTs[] = [];
  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    cur.push(w);
    const next = list[i + 1];
    if (!next) break;
    const curLen = joinText(cur).length;
    const projected = joinText([...cur, next]).length;
    const gap = next.startMs - w.endMs;
    const dur = w.endMs - cur[0].startMs;
    const endsSentence = SENTENCE_END.test(w.text.trim());
    if (projected > cap || gap > o.gapThresholdMs || dur > o.maxDurationMs || (endsSentence && curLen >= o.minSentenceChars)) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);

  // 2) build cues, splitting any single over-long unit
  const cues: SegCue[] = [];
  for (const g of groups) {
    const text = joinText(g);
    const startMs = g[0].startMs;
    const endMs = g[g.length - 1].endMs;
    if (text.length > cap && g.length === 1) cues.push(...splitLongUnit(text, startMs, endMs, o));
    else cues.push({ startMs, endMs, text: wrapLines(text, o.maxCharsPerLine, o.maxLines) });
  }

  // 3) timing clean-up: enforce min duration + CPS, never overlapping the next cue
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const chars = c.text.replace(/\n/g, "").length;
    let end = Math.max(c.endMs, c.startMs + o.minDurationMs, c.startMs + Math.round((chars / o.maxCps) * 1000));
    const nextStart = cues[i + 1]?.startMs ?? Infinity;
    if (nextStart !== Infinity) end = Math.min(end, nextStart - o.minGapMs);
    c.endMs = Math.max(c.startMs + 1, Math.round(end));
  }
  return cues;
}
