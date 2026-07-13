import { describe, it, expect } from "vitest";
import { splitAssRuns, buildTranslationPlan, applyUniqueTranslation, rebuildCueText } from "./translate-plan";

describe("splitAssRuns", () => {
  it("separates override blocks from visible runs, keeping breaks inside runs", () => {
    const parts = splitAssRuns("{\\i1}Hello{\\i0} big\\Nworld");
    expect(parts).toEqual([
      { type: "tag", text: "{\\i1}" },
      { type: "run", text: "Hello" },
      { type: "tag", text: "{\\i0}" },
      { type: "run", text: " big\\Nworld" },
    ]);
  });
});

describe("multi-line cues: flatten for translation, re-wrap after", () => {
  it("sends the whole sentence (breaks flattened) to the model", () => {
    const plan = buildTranslationPlan(["{\\pos(10,10)}I have heard rumors\\Nof a ghost in the net"]);
    expect(plan.uniqueTexts).toEqual(["I have heard rumors\\Nof a ghost in the net"]);
    expect(plan.mtSource).toEqual(["I have heard rumors of a ghost in the net"]);
  });

  it("re-wraps a long translation into balanced lines with the original break token (\\N)", () => {
    const plan = buildTranslationPlan(["Good morning\\Neveryone"]);
    applyUniqueTranslation(plan, 0, "Bonjour tout le monde et bienvenue chez nous ce matin");
    const out = rebuildCueText(plan, 0)!;
    expect(out).not.toContain("\n"); // no real newline
    expect(out).toContain("\\N"); // ASS break re-inserted
    // Both lines are within the wrap width.
    for (const line of out.split("\\N")) expect(line.length).toBeLessThanOrEqual(42);
  });

  it("drops the break when the translation fits on one line", () => {
    const plan = buildTranslationPlan(["Good morning\\Neveryone"]);
    applyUniqueTranslation(plan, 0, "Bonjour");
    expect(rebuildCueText(plan, 0)).toBe("Bonjour");
  });

  it("re-wraps SRT/VTT real-newline cues with a real newline", () => {
    const plan = buildTranslationPlan(["I have heard rumors\nof a ghost in the net"]);
    expect(plan.mtSource).toEqual(["I have heard rumors of a ghost in the net"]);
    applyUniqueTranslation(plan, 0, "J'ai entendu des rumeurs au sujet d'un fantome dans le reseau");
    const out = rebuildCueText(plan, 0)!;
    expect(out).toContain("\n");
    expect(out).not.toContain("\\N");
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
