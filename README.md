# subedit

A standalone, framework-agnostic, client-side **subtitle editor** for **SRT, VTT and
ASS/SSA** (with auto-transcription and subtitle muxing planned). It parses a subtitle
file into an editable cue list, lets you edit timings and text with a video/waveform
preview and live CPS/duration feedback, and writes the changes **back into your file
byte-for-byte** for well-formed files, all in the browser. No server, no upload.

**[▶ Live demo](https://hikashop-nicolas.github.io/subedit/)** — open an `.srt`, `.vtt`
or `.ass` file, or start a new one.

```ts
import { createSubtitleEditor } from "subedit";

const handle = createSubtitleEditor(containerEl, { text: fileText, filename: "subs.srt" }, {
  onChange: () => console.log("edited"),
});

// later, to save:
const edited = handle.getText(); // the edited file, serialized in its format
```

## What it does

- **Edits cues** in a virtualized list (thousands of cues stay responsive): start, end,
  duration, characters-per-second, and text, with a detail editor for the selected cue.
- **Byte-faithful round-trips.** A well-formed SRT/VTT file parses and re-serializes
  identically: line-ending flavor, BOM, VTT header and NOTE/STYLE/REGION blocks, cue
  identifiers and settings are all preserved. Edited cues are re-serialized canonically.
- **Format-aware.** SRT, VTT and ASS/SSA parse/serialize with the correct timestamp form;
  convert between them from the toolbar. ASS keeps its Script Info, styles, fonts and
  comments byte-for-byte, rebuilding only the lines you edit.
- **ASS styling.** A per-cue **Style** picker, a **styles editor** to create / edit /
  duplicate / delete style definitions (font, size, fill/outline colour, bold/italic/
  underline, alignment), and an **inline-formatting toolbar** that wraps the selected text
  in the matching override tags (bold, italic, underline, colour, position).
- **Cue operations:** add / remove, shift all times, fix overlaps, with CPS warnings.
- **Timeline** at the bottom: a waveform of the loaded audio with the cues as blocks you
  can drag to move or resize, a ruler and a playhead, click-to-seek and wheel zoom/pan.
  The waveform is decoded through mediaplay, so it works even for codecs the browser can't
  play natively (Dolby AC-3/E-AC-3, DTS) and streams so large files don't buffer in memory.
- **Preview.** Load a video or audio file to preview alongside the subtitles, powered by
  an embedded [mediaplay](https://github.com/hikashop-nicolas/mediaplay) player (MKV and
  legacy containers, Dolby/DTS audio decode, libass ASS rendering). Double-click a cue to
  seek, the currently-playing cue highlights, and the preview re-renders your edits live
  as you type.
- **Self-contained i18n** (English, French, Japanese), auto-detected, host-overridable
  via `setLocale()`.

## Status

Phases 0-3 done: SRT / VTT / ASS editing (virtualized list, detail editor with a Style
picker for ASS, toolbar); the embedded mediaplay video/audio preview with cue seek,
current-cue highlight and live (libass-styled for ASS) subtitle rendering; and a bottom
**timeline** with a waveform, draggable cue blocks (move / resize), a ruler, a playhead,
click-to-seek and wheel zoom/pan. See [`_plans/SUBEDIT_PLAN.md`](_plans/SUBEDIT_PLAN.md)
for the rest of the roadmap: auto-transcription (Web Speech / Whisper), muxing subtitles
into the video, and Omnitext integration.

## API

`createSubtitleEditor(container, { text, filename? }, options?) -> handle`

- `options.onChange?()` fires after any edit.
- `options.locale?` forces a UI locale (else auto-detected).
- `options.showSave?` toggles the toolbar Save button (hosts that own saving pass false).
- `handle.getText()` serializes the current document; `handle.getDoc()` returns the model;
  `handle.loadPreviewMedia(file)` loads a video/audio file into the preview; `handle.focus()`;
  `handle.destroy()`.

The pure parse/serialize helpers (`parseSubtitles`, `serializeSubtitles`, `parseSrt`,
`parseVtt`, `detectFormat`, `convertDoc`, timestamp helpers) are re-exported for headless
use.

## Development

```bash
npm install
npm run dev        # demo at http://localhost:5173/
npm test           # round-trip + unit tests (vitest)
npm run typecheck
npm run build      # tsc -> dist/
```

## License

MIT.
