# subedit: client-side subtitle editor (draft plan)

## Goal

A standalone, framework-agnostic, browser-only subtitle editor library, same
pattern as pdfedit / sheetedit / geoedit / mediaplay:

- Public repo `github:hikashop-nicolas/subedit`, MIT (name checked free on npm
  and GitHub on 2026-07-12).
- Consumed by Omnitext as a git dependency for opening .srt / .ass / .ssa / .vtt.
- Uses **mediaplay** as a dependency for the video/audio preview pane, which
  brings for free: MKV/legacy container remux, AC-3/E-AC-3/DTS/TrueHD audio
  decode, styled ASS rendering via libass with embedded fonts.
- Everything runs locally; the video never leaves the machine (including
  speech recognition, see ASR section).

## UI layout (modeled on Subtitle Edit's main window)

```
+------------------------------------------------------------------+
| Toolbar: open video | +cue | -cue | shift times | fix overlaps.. |
+--------------------------------------+---------------------------+
| Cue list (virtualized)               | Video preview             |
| # | start | end | dur | CPS | text   | (mediaplay embed, or a    |
|   ...                                |  "Load video/audio" button|
|--------------------------------------|  when none is loaded)     |
| Selected-cue detail editor:          |                           |
| start/end/duration fields + textarea |                           |
+--------------------------------------+---------------------------+
| Waveform / timeline (canvas): cue blocks, playhead, zoom, scrub  |
+------------------------------------------------------------------+
```

- Cue list: virtualized rows (must handle 5000+ cues), columns #, start, end,
  duration, CPS, text preview. Click selects, double-click seeks the video.
  CPS and line-length cells colored when over threshold.
- Detail editor below the list: precise start/end/duration inputs and the text
  area for the selected cue. ASS override tags ({\i1} etc.) are shown raw in
  v1, like Aegisub, no WYSIWYG tag editing.
- Video preview: an embedded mediaplay player. The video is session-local: it
  is picked by the user, never persisted with the document (too big). The last
  video filename can be stored in the subtitle doc's session metadata so we can
  prompt "reload GITS_01.mkv?".
- Waveform strip at the bottom: rendered peaks, cue blocks positioned on the
  timeline, draggable edges (retime), draggable body (shift), click to seek,
  wheel to zoom, playhead follows playback.

## Keyboard model (editor-first)

Space play/pause, arrows seek, [ and ] set selected cue start/end at the
playhead, Enter inserts a cue at the playhead, standard list navigation.
mediaplay's own capture-phase shortcuts must NOT swallow the editor's keys:
the embed needs a mediaplay option to disable or scope its global keydown
handler (upstream change, see below).

## Formats and preservation

Cue model: `{ startMs, endMs, text, styleRef?, layer?, actor?, effect?, raw? }`.

- **SRT** and **VTT**: full parse + serialize. Simple formats, regenerating is
  fine, but preserve BOM, line-ending flavor, and VTT header/NOTE/STYLE blocks.
- **ASS/SSA**: in-place philosophy like the other libs. Only touched Dialogue
  lines are rewritten; [Script Info], [V4+ Styles], [Fonts], [Graphics],
  comments and section order stay byte-identical. Field order follows the
  file's own Format: line. Style names surface as a dropdown per cue.
- Golden round-trip fixtures from day one: parse then serialize an unedited
  file and assert byte-identical output (SRT/VTT modulo none, ASS strictly).
- mediaplay's existing srtToVtt/assToVtt converters are one-way display
  helpers; subedit owns its own round-trip parsers.

## Video preview: mediaplay integration

Upstream additions needed in mediaplay (small, keeps subedit thin):

1. `handle.getMediaElement(): HTMLMediaElement | undefined`, the escape hatch
   giving subedit currentTime, seek, play/pause, timeupdate, captureStream.
2. `handle.setSubtitleText(content: string, filename: string)`: programmatic
   external-subtitle load (same path as the existing "load external subtitle"
   button). subedit feeds the serialized in-progress document, debounced
   (~300ms), so the preview always shows the edited subtitles, with full libass
   styling when the doc is ASS.
3. `opts.embedded?: boolean`: disables mediaplay's document-level capture-phase
   shortcuts and hides the external-subtitle button (subedit owns both).

Sync behaviors: double-click cue seeks; timeupdate highlights the current row
(auto-scroll optional toggle); playhead drawn on the waveform.

## Waveform

- PCM source: `AudioContext.decodeAudioData` for plain audio files; for
  containers (MKV/MP4) use mediabunny's AudioBufferSink through the mediaplay
  dependency; Dolby/DTS tracks can reuse mediaplay's decoder path in a later
  pass (not v1-blocking, the waveform is a nice-to-have per track type).
- Downsample progressively to min/max peak pairs per bucket, render into
  cached canvas tiles per zoom level; extraction runs chunked so the UI stays
  responsive, waveform fills in left to right.
- Interactions: drag cue edges (snap to other cues optional), drag cue body,
  double-click empty area to insert a cue, click to seek.

## Phase 4: ASR / automatic transcription

Decision (2026-07-13): **Whisper via transformers.js is the v1 and only engine.**
Web Speech is dropped, even as a fallback: it is real-time only (25 min video =
25 min), Chrome-only, phrase-level timing, and spotty on-device language coverage.
Whisper gives word-level timestamps (the thing that makes auto-segmentation good),
faster-than-real-time inference on WebGPU, ~99-language multilingual support with
auto-detection, and runs fully locally. The `TranscribeBackend` interface stays so
another engine could be added later, but we build only the Whisper backend.

### Model delivery: download-on-demand, never bundled

No model ships in the subedit bundle. transformers.js fetches the weights from the
Hugging Face CDN on first use and caches them in the browser (Cache Storage /
IndexedDB); every later run is offline. This keeps the shipped binary tiny while
allowing best-quality models.

- **Multilingual models only** (not the `.en` variants) so all ~99 Whisper
  languages work with auto-detection. Use the Xenova/onnx-community ONNX builds
  that transformers.js consumes (quantized for browser size).
- **Model-size selector**, remembered per user, each downloaded on demand when
  first chosen:
  - tiny ~40 MB (fastest, roughest)
  - base ~75 MB (DEFAULT, good balance)
  - small ~150 MB (best quality, slower)
- **Privacy**: the only network call is the one-time model download from the HF
  CDN; audio never leaves the device. Surface this in the UI ("downloads the model
  once, then works offline, your audio is never uploaded"). Optional future: a
  self-hosted-weights toggle for zero third-party contact.
- **CSP note**: on subedit's own GitHub Pages site the fetch is unrestricted; a
  strict-CSP host embedding subedit (Omnitext) must allowlist the HF origin.

### Interface (pluggable, but only Whisper implements it)

```ts
interface TranscribeBackend {
  available(): Promise<boolean>;                 // WebGPU/WASM support probe
  listModels(): { id: string; label: string; sizeMb: number }[];
  transcribe(
    audio: Float32Array,                         // 16 kHz mono, extracted once up front
    opts: { model: string; language?: string },  // language omitted = auto-detect
    onSegment: (seg: { startMs: number; endMs: number; text: string; words?: WordTs[] }) => void,
    onProgress: (p: { stage: "download" | "transcribe"; ratio: number }) => void,
  ): { cancel(): void };
}
```

### Inference details

- Run transformers.js in a **Web Worker** so the UI (and the waveform/preview)
  stays responsive; post progress + segments back to the main thread.
- **Backend**: prefer WebGPU (`device: "webgpu"`, fp16), fall back to WASM (quantized
  int8) when WebGPU is unavailable. Report which is in use, and warn that WASM is
  much slower.
- **Audio**: decode the media to a 16 kHz mono `Float32Array` once (reuse
  mediaplay's decode path / extractWaveformPeaks plumbing, which already handles
  MKV/Dolby/DTS and streams large files), then chunk into ~30 s windows for
  Whisper with a small overlap; use `return_timestamps: "word"` for word-level
  timing, `chunk_length_s`/`stride_length_s` for the long-form pipeline.
- Emit segments incrementally so cues appear live as chunks finish.

### Segmentation module (engine-agnostic, the quality lever)

Separate, unit-tested `segmentToCues(words, opts)` that turns Whisper's word
timestamps into readable cues, independent of the engine:

- break on sentence-ending punctuation and on speech gaps over a threshold;
- cap each cue at ~2 lines, ~42 chars/line, and a max CPS (reading speed); split
  over-long spans at the nearest word boundary / punctuation;
- snap cue start/end to the enclosing word timestamps; enforce a min duration and
  a small inter-cue gap;
- balance a 2-line cue's break near the middle at a word boundary.

This is where subtitle quality lives; keep it pure and covered by golden tests.

### UI / flow

- **Entry points** (one "Auto-transcribe" action):
  a) new empty doc: the empty-state panel offers "Load a video, then generate
     subtitles"; b) existing doc: a toolbar button that appends, or replaces after
     a confirm.
- **Dialog**: model-size picker (with download size + cached state shown), language
  = Auto by default with an override list, Start/Cancel.
- **Progress**: two-phase bar (model download %, then transcription %), the WebGPU/
  WASM badge, live partial cues streaming into the list, and a working Cancel that
  aborts the worker.
- Resulting cues land in the normal editor for correction; format defaults to SRT
  for a fresh doc (convertible as usual).

### New files / touch points

- `src/transcribe/backend.ts` (interface + registry), `src/transcribe/whisper.ts`
  (worker glue + model management), `src/transcribe/whisper.worker.ts` (transformers.js),
  `src/transcribe/segment.ts` (+ `segment.test.ts`), `src/transcribe/ui.ts` (dialog);
  editor.ts wires the toolbar button, empty-state action, and cue insertion, reusing
  `loadPreviewMedia` and the audio-decode path.
- transformers.js is a lazy dynamic import (kept out of the base bundle); the worker
  and its WASM/WebGPU assets load only when transcription starts.

### Spikes to de-risk early

1. transformers.js Whisper in a Worker on GitHub Pages: model fetch + cache, WebGPU
   path, `return_timestamps: "word"` shape, and cancellation.
2. Decode-to-16kHz-mono from the existing mediaplay path for arbitrary containers.
3. Segmentation quality on a couple of real clips (tune thresholds against goldens).

## Mux subtitles into the video file (export)

"Save into video": remux the loaded video with the edited subtitles as an
embedded (soft) track. Always writes a NEW file (containers cannot be spliced
in place, and it protects the source); output goes through
showSaveFilePicker + StreamTarget so multi-GB files never sit in memory.

- Engine: mediabunny (already present via mediaplay). Input from BlobSource,
  video/audio tracks stream-copied packet-by-packet (no re-encode, disk-speed),
  subtitle track added, existing subtitle track optionally replaced or kept.
  Track metadata UI: language, track name, default/forced flags.
- Container support (verified on mediabunny 1.50.8): MKV, WebM and MP4 accept
  subtitle tracks, WebVTT codec only; MOV accepts none. So:
  - SRT/VTT docs: converted to WebVTT and muxed, effectively lossless.
  - ASS docs into MKV: WebVTT would strip all styling while MKV natively
    supports S_TEXT/ASS. Extend mediabunny's Matroska muxer with S_TEXT/ASS +
    S_TEXT/UTF8 (codec ID + ASS header as CodecPrivate + the packed
    "ReadOrder,Layer,Style,..." block payload); PR upstream, local patch as
    fallback until merged.
  - Source container without subtitle support (or MOV/AVI): offer "save as
    MKV" instead (same stream-copy, container swap).
- Round-trip check: reopen the produced file in the preview (mediaplay already
  extracts embedded tracks) as a built-in verification step.
- Hard-burn (rendering subtitles into the picture, re-encode) is OUT of scope;
  it belongs with the transcode machinery in mediaplay's legacy-formats plan.

## Omnitext integration

- Formats .srt / .vtt / .ass / .ssa get a subedit editor module
  (src/editors/subtitle.impl.ts, thin adapter like media.impl.ts, locale
  synced via setLocale). CodeMirror remains available as the alternate raw
  text editor through the existing editor switcher; subedit is the preferred
  editor.
- These are TEXT formats: Omnitext's normal text pipeline (autosave, recovery,
  history) applies, unlike the read-only media viewer. getBytes() serializes
  the current doc; onChange marks dirty.
- New-file flow: rather than modifying Omnitext's new-file form to host a
  video drop area, "New subtitle file" simply opens an empty doc in subedit,
  whose empty state IS the video + auto-generate panel. Same result, zero
  Omnitext-core surgery, and the standalone demo gets the identical flow.
  (If we later want it in the form itself, the form can grow a per-format
  extension slot, deferred.)
- Assets: octopus + libav copies already handled for mediaplay; no new assets
  unless/until the Whisper backend lands (model is fetched at runtime, not
  bundled).

## QA / utility tools (toolbar)

v1: shift all times (offset +/-), fix overlaps, CPS + line-length warnings,
find & replace. Later: change framerate, merge/split cues, remove HI text,
translate mode (two-column original/translation).

## Phases

- **Phase 0, scaffold + formats [DONE]**: repo from the geoedit template (tsc to
  dist/, prepare on git install, demo/, Pages deploy.yml, test.yml). SRT + VTT
  parsers/serializers with golden fixtures, cue model, virtualized cue list,
  detail editor, toolbar shell, i18n en/fr/ja. Usable as a video-less editor.
- **Phase 1, preview [DONE]**: mediaplay upstream API (getMediaElement,
  setSubtitleText, embedded option) shipped in mediaplay; embed + load-video
  button, double-click-cue seek, current-cue highlight on timeupdate, live
  subtitle re-push on edit (300ms debounced), space/arrows keyboard model.
  handle.loadPreviewMedia(file) added for programmatic loading (ASR flow).
- **Phase 2, waveform [DONE]**: bottom canvas timeline (src/waveform.ts) with cue
  blocks, time ruler and playhead; click to seek, wheel to zoom (deltaY) / pan
  (deltaX / shift), drag a cue body to move or its edges to retime. Waveform peaks
  come from mediaplay's extractWaveformPeaks (streamed decode, every playable codec
  incl. E-AC-3/DTS, no file-size cap), shown with an "extracting" progress label
  and aborted when another file loads.
- **Phase 3, ASS [DONE]**: src/ass.ts byte-preserving parse/serialize (Script
  Info / styles / [Fonts] kept verbatim; Dialogue AND Comment lines parsed as cues
  and rebuilt from fields via the section Format order, so an unedited canonical
  line round-trips identically). Format switcher gained ASS with srt/vtt<->ass
  conversion. Live preview renders styled ASS via libass (mediaplay). Extended ASS
  editing shipped: full styles editor (create/edit/dup/delete, all common fields,
  font datalist), per-cue Style picker + Edit button, per-cue actor/effect/layer/
  margins + Comment(disable) toggle, inline B/I/U/colour, position picker (\pos via
  clicking the preview), fade (\fad), karaoke (\k) editor, script-properties panel.
  Word-based alignment labels. Also shipped: transform popover (\frz/\fscx/\fscy/
  \fsp/\blur) with animate (\t); position picker click=\pos / drag=\move; timeline
  block visuals (fade triangles + karaoke syllable marks); rectangular clip
  (\clip/\iclip drag-a-rectangle + inverse); vector drawing tool (\p, click points
  to build a polygon); actor column; effect dropdown with per-effect params; margins
  group (vertical hidden for middle alignment); alignment "no alignment". FUTURE
  (not built): decoding embedded [Fonts] to real font names, complex 7-arg \fade,
  editing an existing drawing's points, bezier (b) drawing commands.
- **Phase 4, ASR**: TranscribeBackend interface + Whisper (transformers.js in a
  Worker, WebGPU/WASM, multilingual auto-detect, download-on-demand + cache, model-
  size selector); engine-agnostic segmentToCues; empty-state + toolbar generate
  flow with two-phase progress and live cues. See the detailed section above.
- **Phase 5, mux export**: "save into video" remux via mediabunny stream copy
  (WebVTT track), then the Matroska S_TEXT/ASS + S_TEXT/UTF8 muxer extension
  (upstream PR) so ASS keeps its styling in MKV.
- **Phase 6, Omnitext**: subtitle.impl.ts, format registration, preferred
  editor wiring, git dep pin, ship to Pages + APK.
- **Later / out of scope for now**: Web Speech / cloud ASR backends, MicroDVD
  (.sub) and other niche text formats, image-based subtitles (VobSub/PGS need OCR,
  out of scope), WYSIWYG ASS tag editing, translate mode.

## Risks

- Whisper model download is 40-150 MB on first use; mitigate with an explicit
  size picker, cached-state indicator, download progress, and a base default.
- WebGPU is not everywhere; the WASM fallback works but is much slower. Detect,
  report which backend is active, and warn on WASM for long media.
- transformers.js is heavy; keep it a lazy dynamic import + Worker so the base
  bundle and the editor stay light.
- mediaplay embed keyboard conflicts: solved by the embedded option, but the
  two projects now version-lock (subedit pins mediaplay like Omnitext pins its
  libs; verify fixes in the consumer's node_modules dist).
- ASS files in the wild are messy (mixed encodings, duplicate sections);
  parser must be lenient on read, conservative on write.
