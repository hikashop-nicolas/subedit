// Pure logic for turning a subtitle track into a de-duplicated translation plan and splicing
// translations back into it. Kept DOM-free so it can be unit-tested independently of the editor.
//
// The plan (a) splits each cue into tag/run parts so only visible text is translated (ASS
// override blocks, \N/\n/\h breaks and real newlines are preserved verbatim), and (b) dedups
// identical run strings: fansub ASS repeats the same line with only the tags differing, and the
// tags live in separate parts, so identical lines share a run string. Each unique string is
// translated once and fanned out to every cue that uses it.

export type CuePart = { type: "tag" | "run"; text: string };

export const splitAssRuns = (text: string): CuePart[] => {
  const parts: CuePart[] = [];
  const re = /(\{[^}]*\}|\\N|\\n|\\h|\r?\n)/g;
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

// Re-wrap a translation with the original run's surrounding whitespace (the model trims it), so
// spacing around inline tags is kept.
export const preserveEdge = (orig: string, trans: string): string => `${orig.match(/^\s*/)?.[0] ?? ""}${trans.trim()}${orig.match(/\s*$/)?.[0] ?? ""}`;

export interface TranslationPlan {
  parsed: (CuePart[] | null)[]; // per cue; null = a drawing cue (\p1..), left untouched
  refs: { c: number; p: number }[]; // each translatable run's (cue index, part index)
  uniqueTexts: string[]; // distinct run strings, in first-seen order
  unique2refs: number[][]; // uniqueIndex -> the ref indices that share that exact text
}

// Build a de-duplicated plan from each cue's raw text. Drawing cues are skipped.
export const buildTranslationPlan = (cueTexts: string[]): TranslationPlan => {
  const parsed = cueTexts.map((text) => (/\\p[1-9]/.test(text) ? null : splitAssRuns(text)));
  const refs: { c: number; p: number }[] = [];
  const uniqueTexts: string[] = [];
  const unique2refs: number[][] = [];
  const indexOf = new Map<string, number>();
  parsed.forEach((parts, ci) => {
    if (!parts) return;
    parts.forEach((part, pi) => {
      if (part.type !== "run" || !part.text.trim()) return;
      const refIdx = refs.length;
      refs.push({ c: ci, p: pi });
      let u = indexOf.get(part.text);
      if (u === undefined) {
        u = uniqueTexts.length;
        indexOf.set(part.text, u);
        uniqueTexts.push(part.text);
        unique2refs.push([]);
      }
      unique2refs[u].push(refIdx);
    });
  });
  return { parsed, refs, uniqueTexts, unique2refs };
};

// Splice one unique text's translation into every cue/part that shares it. Mutates plan.parsed
// and returns the set of touched cue indices so the caller can rebuild just those cues.
export const applyUniqueTranslation = (plan: TranslationPlan, uniqueIndex: number, translation: string): number[] => {
  const touched = new Set<number>();
  for (const refIdx of plan.unique2refs[uniqueIndex] ?? []) {
    const ref = plan.refs[refIdx];
    const parts = plan.parsed[ref.c];
    if (!parts) continue;
    parts[ref.p] = { type: "run", text: preserveEdge(parts[ref.p].text, translation) };
    touched.add(ref.c);
  }
  return [...touched];
};

// Reassemble a cue's text from its parsed parts; null for a drawing cue (leave as-is).
export const rebuildCueText = (plan: TranslationPlan, cueIndex: number): string | null => {
  const parts = plan.parsed[cueIndex];
  return parts ? parts.map((p) => p.text).join("") : null;
};
