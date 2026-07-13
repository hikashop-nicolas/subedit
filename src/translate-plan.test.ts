import { describe, it, expect } from "vitest";
import { splitAssRuns, buildTranslationPlan, applyUniqueTranslation, rebuildCueText } from "./translate-plan";

describe("splitAssRuns", () => {
  it("separates override blocks and breaks from visible runs", () => {
    const parts = splitAssRuns("{\\i1}Hello{\\i0}\\Nworld");
    expect(parts).toEqual([
      { type: "tag", text: "{\\i1}" },
      { type: "run", text: "Hello" },
      { type: "tag", text: "{\\i0}" },
      { type: "tag", text: "\\N" },
      { type: "run", text: "world" },
    ]);
  });
});

describe("buildTranslationPlan dedup", () => {
  it("translates each unique run once and maps it to every cue that shares it", () => {
    // Three cues; cue 0 and cue 2 have the same visible text but different ASS tags/position.
    const cues = ["{\\an8}The cat sleeps.", "A dog barks.", "{\\pos(50,50)}The cat sleeps."];
    const plan = buildTranslationPlan(cues);
    // Only two unique strings, in first-seen order.
    expect(plan.uniqueTexts).toEqual(["The cat sleeps.", "A dog barks."]);
    // The shared line points at two cue refs.
    expect(plan.unique2refs[0]).toHaveLength(2);
    expect(plan.unique2refs[1]).toHaveLength(1);
  });

  it("fans one translation out to all sharing cues, keeping each cue's own tags", () => {
    const cues = ["{\\an8}The cat sleeps.", "A dog barks.", "{\\pos(50,50)}The cat sleeps."];
    const plan = buildTranslationPlan(cues);
    // Translate unique 0 ("The cat sleeps.") once.
    const touched = applyUniqueTranslation(plan, 0, "Le chat dort.");
    expect(touched.sort()).toEqual([0, 2]);
    // Both cues get the translation, each with its original tags preserved.
    expect(rebuildCueText(plan, 0)).toBe("{\\an8}Le chat dort.");
    expect(rebuildCueText(plan, 2)).toBe("{\\pos(50,50)}Le chat dort.");
    // The untouched cue is unchanged.
    expect(rebuildCueText(plan, 1)).toBe("A dog barks.");
  });

  it("preserves whitespace around runs and inline tags", () => {
    const plan = buildTranslationPlan(["Hi {\\b1}there{\\b0} you"]);
    // "Hi ", "there", " you" are three separate runs.
    expect(plan.uniqueTexts).toEqual(["Hi ", "there", " you"]);
    applyUniqueTranslation(plan, 0, "Salut");
    applyUniqueTranslation(plan, 1, "toi");
    applyUniqueTranslation(plan, 2, "vous");
    // Leading/trailing spaces of each run are kept even though the model trims them.
    expect(rebuildCueText(plan, 0)).toBe("Salut {\\b1}toi{\\b0} vous");
  });

  it("skips drawing cues entirely", () => {
    const cues = ["{\\p1}m 0 0 l 10 10{\\p0}", "Hello"];
    const plan = buildTranslationPlan(cues);
    expect(plan.parsed[0]).toBeNull();
    expect(plan.uniqueTexts).toEqual(["Hello"]);
    expect(rebuildCueText(plan, 0)).toBeNull();
  });
});
