// subedit: a standalone, framework-agnostic, client-side subtitle editor for SRT, VTT,
// ASS and SSA, with a video/waveform preview and byte-preserving round-trips.
//
// - editor.ts     the editor UI + the createSubtitleEditor entry point
// - cue.ts        the shared cue model + timestamp helpers
// - srt.ts/vtt.ts byte-faithful parse/serialize per format
// - subtitles.ts  format detection + parse/serialize dispatch + conversion
//
// The pure parse/serialize helpers are re-exported so they can be used headlessly.
export {
  createSubtitleEditor,
  newCueId,
  type SubtitleInput,
  type SubtitleEditorOptions,
  type SubtitleEditorHandle,
} from "./editor";
export { setLocale, t } from "./i18n";
export {
  type Cue,
  type AssStyle,
  type SubtitleDoc,
  type SubtitleFormat,
  blankCue,
  cps,
  visibleText,
  parseTimestamp,
  formatTimestamp,
  formatAssTime,
  sortCues,
} from "./cue";
export { parseSrt, serializeSrt } from "./srt";
export { parseVtt, serializeVtt } from "./vtt";
export { parseAss, serializeAss } from "./ass";
export { parseMicroDvd, serializeMicroDvd } from "./microdvd";
export { parseLrc, serializeLrc } from "./lrc";
export { parseTtml, serializeTtml } from "./ttml";
export { parseSubtitles, serializeSubtitles, detectFormat, convertDoc } from "./subtitles";
export { extractMp4Subtitles, type Mp4SubTrack } from "./mp4subs";
export { muxIntoContainer, muxToFile, type MuxSubtitle, type MuxContainer, type FileWritable } from "./mux";
// Automatic transcription (Whisper). Loaded lazily; transformers.js stays out of the base
// bundle until these are actually called.
export { runWhisper, type WhisperResult, type WhisperRun, type WhisperOptions } from "./transcribe/whisper";
export { decodeToMono16k } from "./transcribe/audio";
export { segmentToCues, wrapLines, type SegCue, type SegmentOptions } from "./transcribe/segment";
export { WHISPER_MODELS, DEFAULT_WHISPER_MODEL, type WordTs, type WhisperModelInfo, type TranscribeProgress } from "./transcribe/backend";
