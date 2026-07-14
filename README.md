# subedit

A standalone, framework-agnostic, client-side **subtitle editor** for **SRT, VTT and
ASS/SSA**. It parses a subtitle file into an editable cue list, lets you edit timings and
text with a video/waveform preview and live CPS/duration feedback, and writes the changes
**back into your file byte-for-byte** for well-formed files. Open a video and it becomes a
media project with multiple subtitle tracks: it reads the embedded tracks, **transcribes**
the audio (Whisper), **translates** a track into another language, and **saves the tracks
back into the video file**. Everything runs in the browser, on device: no server, no
upload, and models/media are streamed so multi-GB files never sit in RAM.

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
- **ASS styling and effects.** A per-cue **Style** picker and a **styles editor** to
  create / edit / duplicate / delete style definitions (font with a used-fonts list, size,
  fill/karaoke/outline/shadow colours, bold/italic/underline/strikeout, scale, spacing,
  angle, border style, margins, encoding). Per-cue fields for actor, effect, layer,
  margins, and a **disable (comment)** toggle. An **inline toolbar** for bold/italic/
  underline/colour, a **transform** popover (rotation/scale/spacing/blur with an animate
  `\t` option), a **position picker** (click the preview for `\pos`, drag for `\move`), a
  **clip** tool (drag a rectangle, `\clip`/`\iclip`), a **draw** tool (click points to make
  a `\p` vector shape), **fade** (`\fad`) and a waveform **karaoke** (`\kf`) editor, and a
  **script-properties** panel. There's an **actor column**, a guided **effect** dropdown,
  and a **margins** group. Timeline cue blocks show fade triangles and karaoke marks.
- **Cue operations:** add / remove, shift all times, fix overlaps, with CPS warnings.
- **Timeline** at the bottom: a waveform of the loaded audio with the cues as blocks you
  can drag to move or resize, a ruler and a playhead, click-to-seek and wheel zoom/pan.
  The waveform is decoded through mediaplay, so it works even for codecs the browser can't
  play natively (Dolby AC-3/E-AC-3, DTS) and streams so large files don't buffer in memory.
- **Preview.** Load a video or audio file to preview alongside the subtitles, powered by
  an embedded [mediaplay](https://github.com/hikashop-nicolas/mediaplay) player (MKV and
  legacy containers, Dolby/DTS audio decode, libass ASS rendering). Double-click a cue to
  seek, the currently-playing cue highlights, and the preview re-renders your edits live
  as you type. The media is streamed from disk, so it isn't held in RAM while you edit.
- **Multiple tracks.** Open a video and each embedded subtitle track (MKV and progressive/
  fragmented MP4) loads as its own track; a track bar switches between them and adds new ones.
- **Transcribe (ASR).** Generate a subtitle track from the audio with Whisper
  (transformers.js, WebGPU with a CPU fallback), models downloaded on demand and cached,
  fully on device. Engine-agnostic segmentation turns word timestamps into readable cues.
- **Translate.** Turn a track into another language with m2m100 or NLLB, as a live
  background job (pause / resume / retry) that keeps ASS tags and re-wraps lines for the
  target language, deduplicating repeated lines and caching downloaded models.
- **Save into the video.** Mux all tracks back into the source container (styled ASS in
  MKV, WebVTT in MP4), stream-copying video/audio with no re-encode, streamed to disk so
  multi-GB files never buffer in memory.
- **Self-contained i18n** (English, French, Japanese), auto-detected, host-overridable
  via `setLocale()`.

## Status

Phases 0-5 done: SRT / VTT / ASS editing (virtualized list, detail editor, Style picker
and styles/effects tools); the embedded mediaplay preview with cue seek, current-cue
highlight and live (libass-styled) rendering; the waveform **timeline** with draggable cue
blocks; and the **media-anchored multi-track workflow**, open a video, load its embedded
tracks, transcribe (Whisper) and translate (m2m100 / NLLB) into new tracks, and mux them
back into the container (streamed to disk). See
[`_plans/SUBEDIT_PLAN.md`](_plans/SUBEDIT_PLAN.md) for the roadmap; next up is Omnitext
integration.

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
