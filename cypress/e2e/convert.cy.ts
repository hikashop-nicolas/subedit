// Switching a document's format from the toolbar, and the keyboard shortcuts.
//
// The conversion logic itself is checked in node, and what it produces is checked against
// ffmpeg and pysubs2 (scripts/check-writers.mjs). Neither of those touches the format switcher
// that a user actually reaches for, which is a <select> wired into a state machine in
// editor.ts, and which can perfectly well pick the wrong target, or lose the cues on the way,
// while every one of those checks stays green.

type Handle = { getText(): string; getDoc(): { format: string } };

const handle = (): Cypress.Chainable<Handle> =>
  cy.window().then((w) => (w as unknown as { subHandle: Handle }).subHandle);

const SAMPLE = [
  "1",
  "00:00:01,000 --> 00:00:03,000",
  "Plain text, with a comma.",
  "",
  "2",
  "00:00:04,000 --> 00:00:06,000",
  "Second cue",
  "on two lines.",
  "",
].join("\n");

function openFile(contents: string, fileName: string): void {
  cy.get("#file").selectFile({ contents: Cypress.Buffer.from(contents), fileName }, { force: true });
  const lines = contents.split(/\r?\n/);
  cy.get(".se-row").first().find(".se-text").should("contain.text", lines[lines.findIndex((l) => l.includes("-->")) + 1]);
}

/** The format switcher is the first select in the toolbar. */
const formatSelect = () => cy.get(".se-root select").first();

describe("changing format from the toolbar", () => {
  beforeEach(() => {
    cy.visit("/");
    openFile(SAMPLE, "sample.srt");
  });

  it("offers the formats and starts on the one the file is in", () => {
    formatSelect().should("have.value", "srt");
    formatSelect().find("option").should("have.length.greaterThan", 10);
  });

  // One per family: a line-based format, an XML one, a JSON one, and a frame-based one, so a
  // conversion that loses its cues in any of those shapes is caught.
  for (const [format, mustContain] of [
    ["vtt", "WEBVTT"],
    ["ass", "[Script Info]"],
    ["ttml", "<tt"],
    ["jsonsub", '"text"'],
    ["sub", "{1}{1}"],
  ] as const) {
    it(`converts to ${format} keeping both cues and their text`, () => {
      formatSelect().select(format);

      cy.get(".se-row").should("have.length", 2);
      handle().then((h) => {
        const out = h.getText();
        expect(h.getDoc().format, "the document really changed format").to.equal(format);
        expect(out, `looks like ${format}`).to.contain(mustContain);
        expect(out, "the first cue survived").to.contain("Plain text, with a comma.");
        expect(out, "the second cue survived").to.contain("Second cue");
      });
    });
  }

  it("converts back to SRT without accumulating anything", () => {
    formatSelect().select("ass");
    formatSelect().select("srt");
    handle().then((h) => {
      const out = h.getText();
      expect(out, "no ASS override tags left behind").to.not.contain("{\\");
      expect(out, "no ASS line breaks left behind").to.not.contain("\\N");
      expect(out).to.contain("Plain text, with a comma.");
    });
  });
});

describe("keyboard shortcuts", () => {
  beforeEach(() => {
    cy.visit("/");
    openFile(SAMPLE, "sample.srt");
    cy.get(".se-row").first().click();
  });

  it("adds a cue with the documented shortcut", () => {
    cy.get(".se-inner").type("{ctrl}{enter}");
    cy.get(".se-row").should("have.length", 3);
  });

  it("removes the selected cue with Delete", () => {
    cy.get(".se-inner").type("{del}");
    cy.get(".se-row").should("have.length", 1);
    handle().then((h) => expect(h.getText()).to.not.contain("Plain text"));
  });

  it("moves the selection with the arrow keys and wraps nothing off the ends", () => {
    cy.get(".se-inner").type("{downarrow}");
    cy.get(".se-row").eq(1).should("have.class", "sel");
    cy.get(".se-inner").type("{downarrow}"); // already last
    cy.get(".se-row").eq(1).should("have.class", "sel");
    cy.get(".se-inner").type("{uparrow}{uparrow}"); // and not past the first
    cy.get(".se-row").eq(0).should("have.class", "sel");
  });
});
