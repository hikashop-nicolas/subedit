// The editing loop, in a real browser.
//
// editor.ts is the largest file in the project and, until this suite, the only one with no
// test of any kind: everything it does it does to the DOM, so vitest cannot reach it. What the
// node suite proves is that the parsers and serializers are right. What it cannot prove is
// that a person clicking on a cue and typing into it ends up with those bytes, which is the
// only thing a user ever actually does.
//
// Every check ends at handle.getText(), the same call the Save button makes, so what is
// asserted is the file that would land on disk rather than the state of some element.

type Handle = {
  getText(): string;
  getDoc(): { cues: { startMs: number; endMs: number; text: string }[]; format: string };
};

/** The demo hangs its editor handle on the window; this is how a host would drive it too. */
const handle = (): Cypress.Chainable<Handle> =>
  cy.window().then((w) => (w as unknown as { subHandle: Handle }).subHandle);

/**
 * Open a file through the demo's real file input.
 *
 * Deliberately not a test-only hook on window: going through the input covers the reading and
 * format detection that happen on open, which is where a file the user picked would first go
 * wrong. The input is hidden behind a styled button, hence `force`.
 */
function openFile(contents: string, fileName: string): void {
  cy.get("#file").selectFile({ contents: Cypress.Buffer.from(contents), fileName }, { force: true });
  // Wait for text only this file has, not merely for a row to exist and not for a row count.
  // The demo shows a sample of its own on load, and reading the picked file is asynchronous,
  // so both of those are already satisfied before the open has happened: an assertion after
  // them races the read and passes or fails on the sample instead.
  const firstLine = contents.split(/\r?\n/)[contents.split(/\r?\n/).findIndex((l) => l.includes("-->")) + 1];
  cy.get(".se-row").first().find(".se-text").should("contain.text", firstLine);
}

const SAMPLE = [
  "1",
  "00:00:01,000 --> 00:00:03,000",
  "First cue.",
  "",
  "2",
  "00:00:04,000 --> 00:00:06,000",
  "Second cue,",
  "over two lines.",
  "",
  "3",
  "00:00:07,000 --> 00:00:09,000",
  "Third cue.",
  "",
].join("\n");

describe("editing a subtitle file", () => {
  beforeEach(() => {
    cy.visit("/");
    openFile(SAMPLE, "sample.srt");
  });

  it("shows every cue, numbered, with its times", () => {
    cy.get(".se-row").should("have.length", 3);
    cy.get(".se-row").eq(0).find(".se-num").should("have.text", "1");
    cy.get(".se-row").eq(0).find(".se-start").should("have.text", "00:00:01,000");
    cy.get(".se-row").eq(2).find(".se-end").should("have.text", "00:00:09,000");
    // A two-line cue is shown on one row with a visible break marker, not truncated.
    cy.get(".se-row").eq(1).find(".se-text").should("contain.text", "over two lines");
  });

  it("gives back the file unchanged when nothing is touched", () => {
    handle().then((h) => expect(h.getText()).to.equal(SAMPLE));
  });

  it("writes an edited cue's text into the saved file, and leaves the rest alone", () => {
    cy.get(".se-row").eq(1).click();
    cy.get(".se-detail textarea").should("have.value", "Second cue,\nover two lines.");
    cy.get(".se-detail textarea").clear().type("Replaced.");
    cy.get(".se-row").eq(0).click(); // commit by moving away

    handle().then((h) => {
      const out = h.getText();
      expect(out, "the edit is in the file").to.contain("Replaced.");
      expect(out, "the old text is gone").to.not.contain("over two lines");
      expect(out, "the other cues are untouched").to.contain("First cue.").and.to.contain("Third cue.");
      expect(out.split("-->"), "still three cues").to.have.length(4);
    });
  });

  it("keeps the selection in step with the arrow keys", () => {
    cy.get(".se-row").eq(0).click();
    cy.get(".se-row").eq(0).should("have.class", "sel");
    cy.get(".se-inner").type("{downarrow}");
    cy.get(".se-row").eq(1).should("have.class", "sel");
  });

  it("adds a cue and renumbers the file", () => {
    cy.get(".se-row").eq(0).click();
    cy.get('[aria-label="Add cue"]').click();

    cy.get(".se-row").should("have.length", 4);
    handle().then((h) => {
      const indices = h.getText().split(/\r?\n/).filter((l) => /^\d+$/.test(l));
      expect(indices, "indices run 1..4 with no gap").to.deep.equal(["1", "2", "3", "4"]);
    });
  });

  it("removes a cue", () => {
    cy.get(".se-row").eq(1).click();
    cy.get('[aria-label="Remove cue"]').click();

    cy.get(".se-row").should("have.length", 2);
    handle().then((h) => expect(h.getText()).to.not.contain("Second cue"));
  });
});
