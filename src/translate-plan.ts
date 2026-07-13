// Pure logic for turning a subtitle track into a de-duplicated translation plan and splicing
// translations back into it. Kept DOM-free so it can be unit-tested independently of the editor.
//
// The plan (a) splits each cue into tag/run parts so only visible text is translated (ASS
// override blocks {\..} are preserved verbatim), and (b) dedups identical run strings: fansub
// ASS repeats the same line with only the tags differing, and the tags live in separate parts,
// so identical lines share a run string. Each unique string is translated once and fanned out
// to every cue that uses it.
//
// Line breaks (\N / \n / real newlines) are NOT treated as boundaries: a two-line cue is one
// run, so the model sees the whole sentence (better translation) instead of two fragments. The
// break is re-inserted afterwards by re-wrapping the translated text where it makes sense, so
// the line is cut for the target language, not the source.
import { wrapLines } from "./transcribe/segment";

export type CuePart = { type: "tag" | "run"; text: string };

const LINE_MAX = 42; // chars per line when re-wrapping a translated multi-line cue

// A line break inside a run: ASS hard "\N", ASS soft "\n", or a real newline (SRT/VTT).
const BREAK_G = /\\N|\\n|\r?\n/g;

export const splitAssRuns = (text: string): CuePart[] => {
  const parts: CuePart[] = [];
  const re = /(\{[^}]*\})/g; // only override blocks are boundaries; breaks stay inside runs
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ type: "run", text: text.slice(last, m.index) });
    parts.push({ type: "tag", text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: "run", text: text.slice(last) });
  return parts;
};

// Flatten a run to the string handed to the model: line breaks and hard spaces become spaces so
// the model translates the whole sentence, not the source-language line fragments.
const toMtSource = (text: string): string => text.replace(/\\N|\\n|\\h|\r?\n/g, " ").replace(/\s+/g, " ").trim();

const breakToken = (text: string): string => (text.includes("\\N") ? "\\N" : /\\n/.test(text) ? "\\n" : "\n");

// Rebuild a run from its translation: keep the original run's leading/trailing breaks and
// whitespace, and if the original was multi-line, re-wrap the translation into up to that many
// balanced lines using the original's break token. A short translation stays on one line.
const rewrapTranslation = (orig: string, translation: string): string => {
  const lead = orig.match(/^(?:\\N|\\n|\\h|\s)*/)?.[0] ?? "";
  const trail = orig.match(/(?:\\N|\\n|\\h|\s)*$/)?.[0] ?? "";
  const core = orig.slice(lead.length, orig.length - trail.length);
  let body = translation.trim();
  const breaks = (core.match(BREAK_G) ?? []).length;
  if (breaks > 0 && body) body = wrapLines(body, LINE_MAX, breaks + 1).split("\n").join(breakToken(core));
  return `${lead}${body}${trail}`;
};

export interface TranslationPlan {
  parsed: (CuePart[] | null)[]; // per cue; null = a drawing cue (\p1..), left untouched
  refs: { c: number; p: number }[]; // each translatable run's (cue index, part index)
  uniqueTexts: string[]; // distinct run strings (the dedup key), in first-seen order
  mtSource: string[]; // uniqueTexts[u] flattened to the string sent to the model
  unique2refs: number[][]; // uniqueIndex -> the ref indices that share that exact text
}

// Build a de-duplicated plan from each cue's raw text. Drawing cues are skipped, and so are runs
// with no translatable content (e.g. a lone break between tags), which stay verbatim.
export const buildTranslationPlan = (cueTexts: string[]): TranslationPlan => {
  const parsed = cueTexts.map((text) => (/\\p[1-9]/.test(text) ? null : splitAssRuns(text)));
  const refs: { c: number; p: number }[] = [];
  const uniqueTexts: string[] = [];
  const mtSource: string[] = [];
  const unique2refs: number[][] = [];
  const indexOf = new Map<string, number>();
  parsed.forEach((parts, ci) => {
    if (!parts) return;
    parts.forEach((part, pi) => {
      if (part.type !== "run") return;
      const src = toMtSource(part.text);
      if (!src) return; // nothing to translate (pure break/whitespace) -> leave verbatim
      const refIdx = refs.length;
      refs.push({ c: ci, p: pi });
      let u = indexOf.get(part.text);
      if (u === undefined) {
        u = uniqueTexts.length;
        indexOf.set(part.text, u);
        uniqueTexts.push(part.text);
        mtSource.push(src);
        unique2refs.push([]);
      }
      unique2refs[u].push(refIdx);
    });
  });
  return { parsed, refs, uniqueTexts, mtSource, unique2refs };
};

// Splice one unique text's translation into every cue/part that shares it, re-wrapping to the
// original's line structure. Mutates plan.parsed and returns the touched cue indices.
export const applyUniqueTranslation = (plan: TranslationPlan, uniqueIndex: number, translation: string): number[] => {
  const rewrapped = rewrapTranslation(plan.uniqueTexts[uniqueIndex], translation);
  const touched = new Set<number>();
  for (const refIdx of plan.unique2refs[uniqueIndex] ?? []) {
    const ref = plan.refs[refIdx];
    const parts = plan.parsed[ref.c];
    if (!parts) continue;
    parts[ref.p] = { type: "run", text: rewrapped };
    touched.add(ref.c);
  }
  return [...touched];
};

// Reassemble a cue's text from its parsed parts; null for a drawing cue (leave as-is).
export const rebuildCueText = (plan: TranslationPlan, cueIndex: number): string | null => {
  const parts = plan.parsed[cueIndex];
  return parts ? parts.map((p) => p.text).join("") : null;
};
