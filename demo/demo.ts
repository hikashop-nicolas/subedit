import { createSubtitleEditor, type SubtitleEditorHandle } from "../src/index";

const editorEl = document.getElementById("editor")!;
const fileInput = document.getElementById("file") as HTMLInputElement;
const newBtn = document.getElementById("new") as HTMLButtonElement;
let handle: SubtitleEditorHandle | null = null;

function open(text: string, filename: string): void {
  handle?.destroy();
  editorEl.textContent = "";
  handle = createSubtitleEditor(editorEl, { text, filename }, {
    onChange: () => console.log("edited"),
  });
  (window as unknown as Record<string, unknown>).subHandle = handle; // handy in the console
}

fileInput.addEventListener("change", async () => {
  const f = fileInput.files?.[0];
  if (f) open(await f.text(), f.name);
});

newBtn.addEventListener("click", () => open("WEBVTT\n\n", "untitled.vtt"));

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
