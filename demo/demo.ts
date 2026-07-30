import { createSubtitleEditor, type SubtitleEditorHandle } from "../src/index";

const editorEl = document.getElementById("editor")!;
const fileInput = document.getElementById("file") as HTMLInputElement;
const openBtn = document.getElementById("open") as HTMLButtonElement;
const newBtn = document.getElementById("new") as HTMLButtonElement;
let handle: SubtitleEditorHandle | null = null;

function open(text: string, filename: string): void {
  handle?.destroy();
  editorEl.textContent = "";
  const win = window as unknown as Record<string, unknown>;
  win.subChangeCount = 0; // lets a host (and the e2e suite) see that onChange really fired
  win.subSelections = [];
  handle = createSubtitleEditor(editorEl, { text, filename }, {
    onChange: () => {
      win.subChangeCount = (win.subChangeCount as number) + 1;
      console.log("edited");
    },
    onSelectionChanged: (cueId) => {
      win.subSelection = cueId;
      (win.subSelections as unknown[]).push(cueId);
    },
  });
  win.subHandle = handle; // handy in the console
}

// The styled Open button proxies to the hidden native file input.
openBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const f = fileInput.files?.[0];
  if (f) open(await f.text(), f.name);
  fileInput.value = ""; // let the same file be re-opened
});

// New: create a blank SubRip document. The format is then chosen/changed from the editor's
// own toolbar format switcher (the single source of truth for the document's format).
newBtn.addEventListener("click", () => open("", "untitled.srt"));

// A small sample so the demo shows something on load.
const SAMPLE = [
  "1",
  "00:00:01,000 --> 00:00:03,500",
  "Welcome to subedit.",
  "",
  "2",
  "00:00:04,000 --> 00:00:07,000",
  "Edit cues, timings and text,",
  "all in your browser.",
  "",
  "3",
  "00:00:08,000 --> 00:00:10,000",
  "Load a video to preview.",
  "",
].join("\n");
open(SAMPLE, "sample.srt");
