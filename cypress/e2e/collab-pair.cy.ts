// Two editors on one page, wired together as a collaboration host wires them.
//
// Each side of this API has its own tests and they all pass; the failures have been at the
// seam. An apply that echoes back to its sender, an undo that takes back someone else's
// typing, a selection that never reaches anyone: none of those are visible from one
// editor, and all of them are obvious the moment two are talking.
//
// No network here. A's changes are handed straight to B, which is what the session does
// once a transport has delivered them, so this runs in a couple of seconds and the same
// way every time.

type Cue = { id: string; startMs: number; endMs: number; text: string };
type PeerCue = { id: string; colour: string; name: string; cueId: string | null };
type UndoHandler = { undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean };

type DocField = { key: string; value: string };
type Handle = {
  docFields(): DocField[];
  setDocFieldsReporter(h: ((f: DocField[]) => void) | null): void;
  applyRemoteDocFields(f: DocField[]): void;
  getText(): string;
  cueSnapshot(): Cue[];
  applyRemoteCues(cues: Cue[]): void;
  setPeerCues(peers: PeerCue[]): void;
  setUndoHandler(h: UndoHandler | null): void;
  selectedCueId(): string | null;
  destroy(): void;
};
type Factory = (
  el: HTMLElement,
  input: { text: string; filename?: string },
  opts: Record<string, unknown>,
) => Handle;

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

interface Pair {
  a: Handle;
  b: Handle;
  /** How many times each side reported a local change. */
  changes: { a: number; b: number };
  /** The colour each side is drawn in, so a marker can be checked against its owner. */
  colours: { a: string; b: string };
}

/**
 * Build both editors from the same file and wire them.
 *
 * The wiring is deliberately the smallest thing that deserves the name: a local change
 * sends the whole cue list across, and a selection change publishes a peer marker. That is
 * what the real binding does, minus the CRDT that would carry it.
 */
function pair(): Cypress.Chainable<Pair> {
  return cy.window().then((w) => {
    const win = w as unknown as { subHandle: Handle; createSubtitleEditor: Factory };
    const state: Pair = {
      a: null as unknown as Handle,
      b: null as unknown as Handle,
      changes: { a: 0, b: 0 },
      colours: { a: "rgb(255, 0, 0)", b: "rgb(0, 0, 255)" },
    };
    let applying = false;

    const mount = (host: HTMLElement, side: "a" | "b"): Handle =>
      win.createSubtitleEditor(host, { text: SAMPLE, filename: "sample.srt" }, {
        showSave: false,
        onChange: () => {
          if (applying) return;
          state.changes[side] += 1;
          const other = side === "a" ? state.b : state.a;
          const mine = side === "a" ? state.a : state.b;
          applying = true;
          other.applyRemoteCues(mine.cueSnapshot());
          applying = false;
        },
        onSelectionChanged: (cueId: string | null) => {
          const other = side === "a" ? state.b : state.a;
          other?.setPeerCues([
            { id: side, colour: state.colours[side], name: side === "a" ? "Ada" : "Bo", cueId },
          ]);
        },
      });

    const aHost = w.document.getElementById("editor") as HTMLElement;
    win.subHandle.destroy();
    aHost.textContent = "";
    state.a = mount(aHost, "a");

    const bHost = w.document.createElement("div");
    bHost.id = "second-editor";
    w.document.body.appendChild(bHost);
    state.b = mount(bHost, "b");

    // B adopts A's cues, ids and all. Cue ids are generated per parse, so two editors that
    // read the same file independently agree on every word and on none of the identities:
    // a marker naming one of A's cues would match nothing in B. A real session avoids this
    // the same way, by having the joiner take the seeder's list.
    applying = true;
    state.b.applyRemoteCues(state.a.cueSnapshot());
    applying = false;
    return state;
  });
}

/** Rows of one side. The second editor's rows are inside #second-editor. */
const rowsOf = (side: "a" | "b") =>
  side === "a" ? cy.get("#editor .se-row") : cy.get("#second-editor .se-row");

describe("two subtitle editors wired together", () => {
  beforeEach(() => cy.visit("/"));

  it("carries an edit from one to the other, and to the file it would save", () => {
    pair().then((p) => {
      const cues = p.a.cueSnapshot();
      cues[1].text = "Edited on A.";
      p.a.applyRemoteCues(cues); // stands in for a keystroke, without the typing
      p.b.applyRemoteCues(p.a.cueSnapshot());

      expect(p.b.getText()).to.contain("Edited on A.");
      expect(p.b.getText()).to.contain("First cue."); // and nothing else moved
    });
    rowsOf("b").eq(1).find(".se-text").should("contain.text", "Edited on A.");
  });

  // The echo test. If applying a peer's cues counted as a local change, each side would
  // hand it back and the two would bounce it forever.
  it("does not send a peer's edit back to them", () => {
    pair().then((p) => {
      const cues = p.a.cueSnapshot();
      cues[0].text = "From A.";
      p.b.applyRemoteCues(cues);
      expect(p.changes.b, "applying is not a local change").to.equal(0);
      expect(p.changes.a).to.equal(0);
    });
  });

  // Clicking a cue really does publish it: the seam that made a peer invisible until they
  // happened to move was on exactly this path.
  //
  // The marker is driven by a real click rather than handed to B directly. Injecting one
  // looks simpler and is wrong here: both editors are wired to publish their own selection,
  // so an injected marker is overwritten by the next notification either side emits, and
  // the test is then racing its own harness. A click is the last thing to move the
  // selection, so what it publishes stays put.
  it("publishes a selection as soon as one side clicks a cue, in that peer's colour", () => {
    pair().then((p) => {
      rowsOf("a").eq(2).click();

      rowsOf("b").eq(2).should("have.class", "se-peer");
      rowsOf("b").eq(2).find(".se-peerflag").should("have.text", "Ada");
      // Both halves of "who is here": the row's border says someone is, the badge says who.
      // With several people on one cue the border can only carry one colour, so the badge is
      // what tells them apart; assert each against the colour its owner was given.
      rowsOf("b").eq(2).should("have.css", "box-shadow", `${p.colours.a} 0px 0px 0px 2px inset`);
      rowsOf("b").eq(2).find(".se-peerflag").should("have.css", "background-color", p.colours.a);
      rowsOf("b").eq(0).should("not.have.class", "se-peer");
    });
  });

  // Moving on must take the old marker with it, or a peer appears to be in two places.
  it("moves the marker when that peer moves, leaving nothing behind", () => {
    pair();
    rowsOf("a").eq(2).click();
    rowsOf("b").eq(2).should("have.class", "se-peer");

    rowsOf("a").eq(0).click();
    rowsOf("b").eq(0).should("have.class", "se-peer");
    rowsOf("b").eq(2).should("not.have.class", "se-peer");
  });

  it("keeps each side's own selection when the other edits elsewhere", () => {
    pair().then((p) => {
      rowsOf("b").eq(2).click();
      cy.get("#second-editor .se-detail textarea").should("have.value", "Third cue.");

      cy.wrap(null).then(() => {
        const cues = p.a.cueSnapshot();
        cues[0].text = "Changed on A.";
        p.b.applyRemoteCues(cues);
      });

      // Still on the third cue: someone else's edit must not move the cursor.
      cy.get("#second-editor .se-detail textarea").should("have.value", "Third cue.");
    });
  });

  // The undo guarantee, at the pair level. B edits, then A's edit arrives; B's undo must
  // take back B's work and leave A's alone.
  it("never lets one side's undo revert the other's edit", () => {
    pair().then((p) => {
      cy.get("#second-editor .se-row").eq(0).click();
      cy.get("#second-editor .se-detail textarea").clear().type("B typed this.");
      cy.get("#second-editor .se-row").eq(2).click(); // commit by moving away

      cy.wrap(null).then(() => {
        const cues = p.b.cueSnapshot();
        cues[2].text = "A typed this.";
        p.b.applyRemoteCues(cues);
      });
      rowsOf("b").eq(2).find(".se-text").should("contain.text", "A typed this.");

      cy.get("#second-editor .se-root").type("{ctrl}z");

      cy.wrap(null).then(() => {
        expect(p.b.getText(), "the other side's edit survives").to.contain("A typed this.");
        expect(p.b.getText(), "and mine does too, the stack having been dropped").to.contain(
          "B typed this.",
        );
      });
    });
  });

  it("hands undo to a host that asks for it, on either side", () => {
    pair().then((p) => {
      const calls: string[] = [];
      const handler: UndoHandler = {
        undo: () => calls.push("undo"),
        redo: () => calls.push("redo"),
        canUndo: () => true,
        canRedo: () => true,
      };
      p.b.setUndoHandler(handler);

      cy.get("#second-editor .se-root").type("{ctrl}z");
      cy.get("#second-editor .se-root").type("{ctrl}{shift}z");
      cy.wrap(null).then(() => {
        expect(calls).to.deep.equal(["undo", "redo"]);
        expect(p.b.getText()).to.contain("First cue."); // its own history untouched
      });
    });
  });
});

// Everything a subtitle document is besides its cues: the ASS style table, the verbatim
// script-info and tail, the format field orders, the line endings, and the tracks.
describe("two subtitle editors, the document beside its cues", () => {
  beforeEach(() => cy.visit("/"));

  it("reports the document fields", () => {
    pair().then((p) => {
      const keys = p.a.docFields().map((f) => f.key);
      expect(keys, "the format travels").to.include("format");
      expect(keys).to.include("eol");
    });
  });

  it("carries a field to the other editor", () => {
    pair().then((p) => {
      p.b.applyRemoteDocFields([{ key: "header", value: "WEBVTT - from Ada\n" }]);
      const header = p.b.docFields().find((f) => f.key === "header");
      expect(header?.value).to.contain("from Ada");
    });
  });

  // Keyed per entry, so two people changing different things both keep their change.
  it("keeps two different fields changed at once", () => {
    pair().then((p) => {
      p.b.applyRemoteDocFields([
        { key: "header", value: "WEBVTT - Ada\n" },
        { key: "trailingNotes", value: "NOTE from Bo\n" },
      ]);
      const get = (k: string) => p.b.docFields().find((f) => f.key === k)?.value;
      expect(String(get("header"))).to.contain("Ada");
      expect(String(get("trailingNotes"))).to.contain("Bo");
    });
  });

  // A style table is a list of independent definitions; two people editing different
  // styles must both survive, which is why each is its own entry.
  it("carries one style without touching another", () => {
    pair().then((p) => {
      p.b.applyRemoteDocFields([
        { key: "style:Default", value: JSON.stringify({ name: "Default", Fontsize: "40" }) },
        { key: "style:Title", value: JSON.stringify({ name: "Title", Fontsize: "72" }) },
      ]);
      const styles = p.b.docFields().filter((f) => f.key.startsWith("style:"));
      expect(styles.map((s) => s.key).sort()).to.deep.equal(["style:Default", "style:Title"]);
    });
  });

  it("does not report a peer's change back to them", () => {
    pair().then((p) => {
      const seen: unknown[] = [];
      p.b.setDocFieldsReporter((f) => seen.push(f));
      p.b.applyRemoteDocFields([{ key: "header", value: "WEBVTT - quiet\n" }]);
      cy.wrap(null).then(() => {
        expect(seen, "applying is not a change to announce").to.deep.equal([]);
      });
    });
  });
});
