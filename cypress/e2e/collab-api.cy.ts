// The API a collaboration host drives, in a real browser.
//
// applyRemoteCues exists so another person's edit can be put into this editor. Its two
// guarantees are both about what must NOT happen, which is exactly the kind of thing that
// looks fine by eye and is wrong in a session:
//
//   - it must not fire onChange, or the remote edit echoes straight back to its sender;
//   - it must not push an undo step, or your Ctrl+Z starts undoing someone else's typing.
//
// Both are asserted here rather than assumed, because neither is visible on screen.

type Cue = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  identifier?: string;
  settings?: string;
};

type Handle = {
  getText(): string;
  getDoc(): { cues: Cue[]; format: string };
  cueSnapshot(): Cue[];
  applyRemoteCues(cues: Cue[]): void;
  setUndoHandler(h: { undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean } | null): void;
  setPeerCues(peers: { id: string; colour: string; name: string; cueId: string | null }[]): void;
  selectedCueId(): string | null;
};

const handle = (): Cypress.Chainable<Handle> =>
  cy.window().then((w) => (w as unknown as { subHandle: Handle }).subHandle);

function openFile(contents: string, fileName: string): void {
  cy.get("#file").selectFile({ contents: Cypress.Buffer.from(contents), fileName }, { force: true });
  const lines = contents.split(/\r?\n/);
  const firstLine = lines[lines.findIndex((l) => l.includes("-->")) + 1];
  cy.get(".se-row").first().find(".se-text").should("contain.text", firstLine);
}

const SAMPLE = [
  "1",
  "00:00:01,000 --> 00:00:03,000",
  "First cue.",
  "",
  "2",
  "00:00:04,000 --> 00:00:06,000",
  "Second cue.",
  "",
  "3",
  "00:00:07,000 --> 00:00:09,000",
  "Third cue.",
  "",
].join("\n");

describe("the collaboration API", () => {
  beforeEach(() => {
    cy.visit("/");
    openFile(SAMPLE, "sample.srt");
  });

  it("hands back a snapshot that does not change under the caller", () => {
    handle().then((h) => {
      const before = h.cueSnapshot();
      expect(before).to.have.length(3);
      before[0].text = "mutated by the caller";
      // The editor's own cue is untouched: a binding diffing against a snapshot needs this.
      expect(h.getDoc().cues[0].text).to.equal("First cue.");
    });
  });

  it("applies a remote edit to the list, the file and the screen", () => {
    handle().then((h) => {
      const cues = h.cueSnapshot();
      cues[1].text = "Edited by someone else.";
      h.applyRemoteCues(cues);
    });

    cy.get(".se-row").eq(1).find(".se-text").should("contain.text", "Edited by someone else.");
    handle().then((h) => {
      expect(h.getText()).to.contain("Edited by someone else.");
      expect(h.getText()).to.contain("First cue.");
    });
  });

  it("applies an insertion and a removal, not only a text change", () => {
    handle().then((h) => {
      const cues = h.cueSnapshot();
      const added = { ...cues[2], id: "remote-new", startMs: 10000, endMs: 12000, text: "Added remotely." };
      h.applyRemoteCues([cues[0], added, cues[2]]); // second cue removed, a new one inserted
    });

    cy.get(".se-row").should("have.length", 3);
    cy.get(".se-row").eq(1).find(".se-text").should("contain.text", "Added remotely.");
    handle().then((h) => {
      expect(h.getText()).to.not.contain("Second cue.");
      expect(h.getText()).to.contain("Added remotely.");
    });
  });

  // The no-echo guarantee. A binding calls applyRemoteCues when a peer's edit arrives; if
  // that fired onChange, the host would treat it as a local edit and send it back out.
  it("does not report a remote edit as a local change", () => {
    cy.window().then((w) => {
      const win = w as unknown as { subChangeCount?: number };
      const before = win.subChangeCount ?? 0;
      const h = (w as unknown as { subHandle: Handle }).subHandle;
      const cues = h.cueSnapshot();
      cues[0].text = "From a peer.";
      h.applyRemoteCues(cues);
      expect(win.subChangeCount ?? 0, "onChange must not fire for a remote edit").to.equal(before);
    });
  });

  /**
   * The one that found a real defect. This editor's undo restores a whole-model snapshot,
   * so a snapshot taken before a peer's edit still lacks it: pressing undo reverted THEIR
   * work as well as mine, and the two documents diverged with nobody told.
   *
   * With no host owning undo, the safe direction to be wrong in is to lose this peer's
   * undo rather than someone else's text, so a remote edit drops the local stack.
   */
  it("never reverts a remote edit through the local undo", () => {
    cy.get(".se-row").eq(0).click();
    cy.get(".se-detail textarea").clear().type("My own edit.");
    cy.get(".se-row").eq(2).click(); // commit by moving away
    handle().then((h) => expect(h.getText()).to.contain("My own edit."));

    handle().then((h) => {
      const cues = h.cueSnapshot();
      cues[2].text = "Their edit.";
      h.applyRemoteCues(cues);
    });
    cy.get(".se-row").eq(2).find(".se-text").should("contain.text", "Their edit.");

    cy.get(".se-root").type("{ctrl}z");

    handle().then((h) => {
      const out = h.getText();
      expect(out, "someone else's edit must survive my undo").to.contain("Their edit.");
      expect(out, "and mine is still there, because the stack was dropped").to.contain("My own edit.");
    });
  });

  // How a session actually keeps undo working: the host takes it over and undoes only what
  // this peer did. Here we only check the wiring, which is subedit's half of the contract.
  it("hands undo and redo to a host that asks for them", () => {
    cy.window().then((w) => {
      const h = (w as unknown as { subHandle: Handle }).subHandle;
      const calls: string[] = [];
      h.setUndoHandler({
        undo: () => calls.push("undo"),
        redo: () => calls.push("redo"),
        canUndo: () => true,
        canRedo: () => true,
      });
      (w as unknown as { calls: string[] }).calls = calls;
    });

    cy.get(".se-root").type("{ctrl}z");
    cy.get(".se-root").type("{ctrl}{shift}z");

    cy.window().then((w) => {
      expect((w as unknown as { calls: string[] }).calls).to.deep.equal(["undo", "redo"]);
      // And the editor's own history was not touched: the file is unchanged.
      const h = (w as unknown as { subHandle: Handle }).subHandle;
      expect(h.getText()).to.contain("First cue.");
    });
  });

  it("keeps the selection when the selected cue survives a remote edit", () => {
    cy.get(".se-row").eq(2).click();
    cy.get(".se-detail textarea").should("have.value", "Third cue.");

    handle().then((h) => {
      const cues = h.cueSnapshot();
      cues[0].text = "Changed elsewhere.";
      h.applyRemoteCues(cues);
    });

    // Still on the third cue: a remote edit somewhere else must not move the cursor.
    cy.get(".se-detail textarea").should("have.value", "Third cue.");
  });
});

// Seeing where the other people are. Presence is the only thing that makes a shared session
// feel like one, and it is entirely visual, so it is only testable here.
describe("peer presence", () => {
  beforeEach(() => {
    cy.visit("/");
    cy.get("#file").selectFile(
      { contents: Cypress.Buffer.from(SAMPLE), fileName: "sample.srt" },
      { force: true },
    );
    cy.get(".se-row").first().find(".se-text").should("contain.text", "First cue.");
  });

  it("reports which cue this person moved to", () => {
    cy.window().then((w) => ((w as unknown as { subSelections: unknown[] }).subSelections = []));
    cy.get(".se-row").eq(2).click();
    cy.window().then((w) => {
      const seen = (w as unknown as { subSelections: (string | null)[] }).subSelections;
      const h = (w as unknown as { subHandle: Handle }).subHandle;
      expect(seen.length, "a move is announced").to.be.greaterThan(0);
      expect(seen.at(-1)).to.equal(h.cueSnapshot()[2].id);
    });
  });

  it("marks the cue another person is on, in their colour", () => {
    handle().then((h) => {
      const cues = h.cueSnapshot();
      h.setPeerCues([{ id: "p1", colour: "rgb(255, 0, 0)", name: "Ada", cueId: cues[1].id }]);
    });

    cy.get(".se-row").eq(1).should("have.class", "se-peer");
    cy.get(".se-row").eq(1).find(".se-peerflag").should("have.length", 1).and("have.text", "Ada");
    cy.get(".se-row").eq(1).should("have.css", "box-shadow").and("contain", "rgb(255, 0, 0)");
    cy.get(".se-row").eq(0).should("not.have.class", "se-peer");
  });

  it("moves the marker when they move, and clears it when they leave", () => {
    handle().then((h) => {
      const cues = h.cueSnapshot();
      h.setPeerCues([{ id: "p1", colour: "rgb(0, 128, 0)", name: "Ada", cueId: cues[0].id }]);
      h.setPeerCues([{ id: "p1", colour: "rgb(0, 128, 0)", name: "Ada", cueId: cues[2].id }]);
    });
    cy.get(".se-row").eq(0).should("not.have.class", "se-peer");
    cy.get(".se-row").eq(2).should("have.class", "se-peer");

    handle().then((h) => h.setPeerCues([]));
    cy.get(".se-row").eq(2).should("not.have.class", "se-peer");
  });

  // Several people on one cue: the row has one border, so it can only carry one colour.
  // Each name gets its own badge in that person's colour, or two peers on the same cue
  // would be indistinguishable.
  it("gives everyone on the same cue their own badge, in their own colour", () => {
    handle().then((h) => {
      const id = h.cueSnapshot()[1].id;
      h.setPeerCues([
        { id: "p1", colour: "rgb(255, 0, 0)", name: "Ada", cueId: id },
        { id: "p2", colour: "rgb(0, 0, 255)", name: "Grace", cueId: id },
      ]);
    });

    cy.get(".se-row").eq(1).find(".se-peerflag").should("have.length", 2);
    cy.get(".se-row").eq(1).find(".se-peerflag").eq(0).should("have.text", "Ada");
    cy.get(".se-row").eq(1).find(".se-peerflag").eq(1).should("have.text", "Grace");
    cy.get(".se-row").eq(1).find(".se-peerflag").eq(0)
      .should("have.css", "background-color", "rgb(255, 0, 0)");
    cy.get(".se-row").eq(1).find(".se-peerflag").eq(1)
      .should("have.css", "background-color", "rgb(0, 0, 255)");
    // Still exactly one border on the row.
    cy.get(".se-row").eq(1).should("have.class", "se-peer");
  });

  it("removes a badge when only one of two peers moves away", () => {
    handle().then((h) => {
      const cues = h.cueSnapshot();
      h.setPeerCues([
        { id: "p1", colour: "rgb(255, 0, 0)", name: "Ada", cueId: cues[1].id },
        { id: "p2", colour: "rgb(0, 0, 255)", name: "Grace", cueId: cues[1].id },
      ]);
      h.setPeerCues([
        { id: "p1", colour: "rgb(255, 0, 0)", name: "Ada", cueId: cues[1].id },
        { id: "p2", colour: "rgb(0, 0, 255)", name: "Grace", cueId: cues[2].id },
      ]);
    });
    cy.get(".se-row").eq(1).find(".se-peerflag").should("have.length", 1).and("have.text", "Ada");
    cy.get(".se-row").eq(2).find(".se-peerflag").should("have.length", 1).and("have.text", "Grace");
  });

  // The markers have to survive the list being rebuilt, which happens on any remote edit.
  it("keeps the markers when a remote edit rebuilds the list", () => {
    handle().then((h) => {
      const cues = h.cueSnapshot();
      h.setPeerCues([{ id: "p1", colour: "rgb(255, 0, 0)", name: "Ada", cueId: cues[1].id }]);
      const edited = h.cueSnapshot();
      edited[0].text = "Changed remotely.";
      h.applyRemoteCues(edited);
    });
    cy.get(".se-row").eq(0).find(".se-text").should("contain.text", "Changed remotely.");
    cy.get(".se-row").eq(1).should("have.class", "se-peer");
  });
});

describe("the current position", () => {
  // Publishing on bind is what stops a peer being invisible until they happen to move,
  // which is how it behaved the first time two tabs were watched.
  it("can be read without waiting for a move", () => {
    cy.visit("/");
    cy.get("#file").selectFile(
      { contents: Cypress.Buffer.from(SAMPLE), fileName: "sample.srt" },
      { force: true },
    );
    cy.get(".se-row").first().find(".se-text").should("contain.text", "First cue.");

    handle().then((h) => {
      expect(h.selectedCueId(), "a freshly opened file has a selection").to.equal(
        h.cueSnapshot()[0].id,
      );
    });

    cy.get(".se-row").eq(2).click();
    handle().then((h) => expect(h.selectedCueId()).to.equal(h.cueSnapshot()[2].id));
  });
});
