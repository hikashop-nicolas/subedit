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

## ASR: automatic transcription (new-file flow)

Pluggable backend interface so engines can be swapped:

```ts
interface TranscribeBackend {
  available(): Promise<boolean>;
  transcribe(media: HTMLMediaElement, opts: { lang?: string },
             onCue: (cue: { startMs, endMs, text }) => void,
             onProgress: (ratio: number) => void): { cancel(): void };
}
```

**Backend 1 (v1): Web Speech API.** Chrome now supports passing a
MediaStreamTrack as the recognition source and `processLocally = true` for
on-device recognition, so the audio is not sent to Google when the on-device
pack is available. Flow: `video.captureStream()`, take the audio track, start
`SpeechRecognition` on it, play the video (element volume 0; NOTE verify in
implementation whether captureStream audio is pre- or post-volume, the spec
says capture is not affected by volume/muted but this must be tested), map
result events to cues using result timestamps / media currentTime, split long
results into readable cues (max 2 lines, max ~42 chars/line, CPS cap).
Limitations to surface in the UI: runs in real time (a 25 min video takes
25 min, show progress + partial cues appearing live), phrase-level timing
accuracy, Chrome-only, language availability depends on the browser's
on-device packs (fall back to cloud recognition only with an explicit user
opt-in checkbox, privacy default is local-only).

**Backend 2 (later): Whisper via transformers.js.** Fully offline, word-level
timestamps, faster than real time on WebGPU, but a 40-200MB model download
(cached in browser storage) and a heavy dependency. Ship as a lazy opt-in
second backend once the Web Speech path works. Not v1.

**Entry points**: the same "Auto-transcribe" action serves both flows: a) new
empty document (the empty-state panel offers "Load a video, then generate
subtitles automatically"), b) existing document (toolbar button, appends or
replaces after confirm).

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

- **Phase 0, scaffold + formats**: repo from the geoedit template (tsc to
  dist/, prepare on git install, demo/, Pages deploy.yml, test.yml). SRT + VTT
  parsers/serializers with golden fixtures, cue model, virtualized cue list,
  detail editor, toolbar shell, i18n en/fr/ja. Usable as a video-less editor.
- **Phase 1, preview**: mediaplay upstream API (getMediaElement,
  setSubtitleText, embedded option), embed + load-video button, cue/playhead
  sync, live subtitle preview, keyboard model.
- **Phase 2, waveform**: PCM extraction, peak tiles, seek/zoom/drag retiming.
- **Phase 3, ASS**: round-trip parser with section preservation, style
  dropdown, libass-styled preview via setSubtitleText.
- **Phase 4, ASR**: TranscribeBackend interface + Web Speech implementation,
  empty-state generate flow, cue splitting heuristics.
- **Phase 5, mux export**: "save into video" remux via mediabunny stream copy
  (WebVTT track), then the Matroska S_TEXT/ASS + S_TEXT/UTF8 muxer extension
  (upstream PR) so ASS keeps its styling in MKV.
- **Phase 6, Omnitext**: subtitle.impl.ts, format registration, preferred
  editor wiring, git dep pin, ship to Pages + APK.
- **Later / out of scope for now**: Whisper backend, MicroDVD (.sub) and other
  niche text formats, image-based subtitles (VobSub/PGS need OCR, out of
  scope), WYSIWYG ASS tag editing, translate mode.

## Risks

- Web Speech availability/quality varies (Chrome-only, per-language on-device
  packs, phrase-level timings). Mitigation: feature-detect, show capability
  status in the UI, keep the backend interface so Whisper can replace it.
- captureStream + muted playback interaction needs a spike early in Phase 4.
- mediaplay embed keyboard conflicts: solved by the embedded option, but the
  two projects now version-lock (subedit pins mediaplay like Omnitext pins its
  libs; verify fixes in the consumer's node_modules dist).
- ASS files in the wild are messy (mixed encodings, duplicate sections);
  parser must be lenient on read, conservative on write.
