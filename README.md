# subedit

A standalone, framework-agnostic, client-side **subtitle editor** for **SRT and VTT**
(with ASS/SSA, a video/waveform preview and auto-transcription planned). It parses a
subtitle file into an editable cue list, lets you edit timings and text with live CPS
and duration feedback, and writes the changes **back into your file byte-for-byte** for
well-formed files, all in the browser. No server, no upload.

**[▶ Live demo](https://hikashop-nicolas.github.io/subedit/)** — open an `.srt` or
`.vtt` file, or start a new one.

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
- **Format-aware.** SRT and VTT parse/serialize with the correct timestamp form; convert
  between them from the toolbar.
- **Cue operations:** add / remove, shift all times, fix overlaps, with CPS warnings.
- **Preview.** Load a video or audio file to preview alongside the subtitles: double-click
  a cue to seek, and the currently-playing cue highlights. (A later phase swaps in the
  [mediaplay](https://github.com/hikashop-nicolas/mediaplay) embed for full-format
  playback and live subtitle rendering.)
- **Self-contained i18n** (English, French, Japanese), auto-detected, host-overridable
  via `setLocale()`.

## Status

Phase 0 (this release): SRT + VTT editing, virtualized list, detail editor, toolbar,
minimal preview. See [`_plans/SUBEDIT_PLAN.md`](_plans/SUBEDIT_PLAN.md) for the roadmap:
mediaplay preview embed, waveform timeline, ASS round-trip, auto-transcription
(Web Speech / Whisper), muxing subtitles into the video, and Omnitext integration.

## API

`createSubtitleEditor(container, { text, filename? }, options?) -> handle`

- `options.onChange?()` fires after any edit.
- `options.locale?` forces a UI locale (else auto-detected).
- `options.showSave?` toggles the toolbar Save button (hosts that own saving pass false).
- `handle.getText()` serializes the current document; `handle.getDoc()` returns the model;
  `handle.focus()`; `handle.destroy()`.

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
