// The subtitle editor UI and the createSubtitleEditor entry point.
//
// Layout: a toolbar on top; below it a row with the cue list + a detail editor on the
// left and a video/audio preview on the right. The cue list is virtualized so files
// with thousands of cues stay responsive. The preview is a plain <video> in this phase
// (double-click a cue to seek, current cue highlights); a later phase swaps in the
// mediaplay embed for full-format playback and live subtitle rendering.

import {
  type Cue,
  type AssStyle,
  type SubtitleDoc,
  type SubtitleFormat,
  blankCue,
  cps,
  formatTimestamp,
  newCueId,
  parseTimestamp,
  sortCues,
  visibleText,
} from "./cue";
import { parseSubtitles, serializeSubtitles, convertDoc } from "./subtitles";
import { styleNames, assColorToHex, makeDefaultStyle, uniqueStyleName, getPlayRes, embeddedFontNames } from "./ass";
import { openStyleEditor, openScriptProperties } from "./styles-editor";
import { openKaraoke } from "./karaoke";
import { setLocale, t, alignmentOptions } from "./i18n";
import { Timeline } from "./waveform";
import { createMediaPlayer, extractWaveformPeaks, extractMkvSubtitles, type MediaPlayerHandle, type MkvSubtitleTrack } from "mediaplay";
import { extractMp4Subtitles } from "./mp4subs";
import { runTranslate, type TranslateRun } from "./transcribe/translate";
import { buildTranslationPlan, applyUniqueTranslation, rebuildCueText, type TranslationPlan } from "./translate-plan";

export interface SubtitleInput {
  text: string;
  filename?: string;
}

// A vertex of an ASS drawing, in PlayRes coordinates. `type` is how it connects from the
// previous vertex: "m" start, "l" straight line, "b" cubic bezier (with control points),
// "s" b-spline control point (a run of consecutive "s" nodes forms one spline).
interface DrawNode {
  type: "m" | "l" | "b" | "s";
  px: number;
  py: number;
  c1?: { px: number; py: number };
  c2?: { px: number; py: number };
}

export interface SubtitleEditorOptions {
  // Called after any edit that changes the document.
  onChange?: () => void;
  // Force a UI locale (else auto-detected from the browser).
  locale?: string;
  // Show the toolbar Save button (downloads the file). Hosts that own saving pass false.
  showSave?: boolean;
}

export interface SubtitleEditorHandle {
  getText(): string;
  getDoc(): SubtitleDoc;
  // Load a video/audio file into the preview pane programmatically (same as the
  // "Load video" button). Useful for a host that already has the media in hand.
  loadPreviewMedia(file: File): void;
  focus(): void;
  destroy(): void;
}

// One subtitle track of a media-anchored project: an independent, editable document plus a
// display label and (optional) language tag. Opening a bare subtitle file yields one track.
export interface Track {
  id: string;
  label: string;
  language: string;
  doc: SubtitleDoc;
  job?: TranslationJob;
}

// One undo/redo entry: the full editable model minus transient bits (a running translation
// job isn't snapshotted). Only plain data, so it deep-clones cleanly.
interface HistorySnap {
  tracks: { id: string; label: string; language: string; doc: SubtitleDoc }[];
  activeTrackId: string;
  selectedId: string | null;
}
const HIST_MAX = 100;

// An in-progress background translation attached to a track. The track's cues are filled live
// as the worker streams batches; `parsed`/`refs` map each translatable run back to its cue so
// results can be spliced in without disturbing tags. Can be paused/resumed/stopped.
interface TranslationJob {
  run: TranslateRun | null; // null while stopped/errored (no live worker)
  state: "running" | "paused" | "error";
  stage: "download" | "translate";
  device?: "webgpu" | "wasm";
  ratio: number;
  plan: TranslationPlan;
  opts: { model: string; srcLang: string; tgtLang: string }; // to resume/retry a fresh pass
  translated: boolean[]; // per unique text; survives errors so retry only does the rest
  errorMsg?: string;
  done: number; // unique texts translated so far
  total: number; // total unique texts to translate
}

let trackSeq = 0;
const newTrackId = (): string => `tr${(trackSeq += 1)}`;

// Embedded tracks tag language as ISO 639-2 (e.g. "eng"); map to the 2-letter code the UI
// (track label, translate source auto-detect) uses. "und"/unknown -> "".
const LANG3TO2: Record<string, string> = { eng: "en", fra: "fr", fre: "fr", jpn: "ja", spa: "es", deu: "de", ger: "de", ita: "it", por: "pt", nld: "nl", dut: "nl", rus: "ru", zho: "zh", chi: "zh", kor: "ko", ara: "ar" };
const normalizeLang = (code?: string): string => {
  const c = (code ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!c || c === "und") return "";
  return c.length === 3 ? (LANG3TO2[c] ?? c) : c;
};

// Best-effort label + language from a filename, recognising a ".<lang>." tag (e.g.
// "movie.en.srt" -> language "en").
function deriveTrackMeta(filename?: string): { label: string; language: string } {
  if (!filename) return { label: t("track"), language: "" };
  const base = filename.replace(/\.[^.]+$/, ""); // strip extension
  const m = base.match(/[.\-_]([a-z]{2,3})$/i);
  const language = m && /^(en|fr|ja|es|de|it|pt|nl|ru|zh|ko|ar)$/i.test(m[1]) ? m[1].toLowerCase() : "";
  return { label: base || t("track"), language };
}

const ROW_H = 46; // px per cue row
const OVERSCAN = 6; // extra rows rendered above/below the viewport
const CPS_WARN = 21;
const CPS_BAD = 27;

// Inline stroke icons for the toolbar (16-unit viewBox, currentColor), same style as
// richdoc. Each button pairs one of these with a title/aria-label tooltip.
const svgIcon = (inner: string): string =>
  `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON = {
  add: svgIcon('<path d="M8 3.5v9M3.5 8h9"/>'),
  remove: svgIcon('<path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.4 8.5h6.2l.4-8.5"/>'),
  shift: svgIcon('<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2.2 1.3"/>'),
  overlaps: svgIcon('<rect x="2.5" y="3.5" width="7" height="4" rx="1"/><rect x="6.5" y="8.5" width="7" height="4" rx="1"/>'),
  styles: svgIcon('<path d="M5 3.5h6M8 3.5v9M5.5 12.5h5"/><path d="M11.5 8.5l2-2 1.5 1.5-2 2z"/>'),
  script: svgIcon('<rect x="3" y="2.5" width="10" height="11" rx="1"/><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3"/>'),
  mic: svgIcon('<rect x="6" y="2" width="4" height="7" rx="2"/><path d="M4 7a4 4 0 0 0 8 0M8 11v2.5M6 13.5h4"/>'),
  fade: svgIcon('<path d="M2 13l5-10v10z" fill="currentColor" stroke="none"/><path d="M14 13L9 3v10z" fill="currentColor" stroke="none" opacity="0.5"/>'),
  transform: svgIcon('<path d="M12.5 5A5.5 5.5 0 1 0 13 8.5"/><path d="M11 2.5v3h3"/>'),
  clip: svgIcon('<path d="M2 5h9v9M5 2v3M5 5h6v6"/><rect x="2" y="8" width="6" height="6" rx="1" stroke-dasharray="2 1.5"/>'),
  draw: svgIcon('<path d="M11 3.5l1.5 1.5-7 7L3.5 13l1-2z"/><path d="M10 4.5l1.5 1.5"/>'),
  save: svgIcon('<path d="M8 2.5v7.5M5 7.5l3 3 3-3M3.5 13h9"/>'),
  transcribe: svgIcon('<path d="M3 8v0M5.5 5.5v5M8 3.5v9M10.5 6v4M13 8v0"/><path d="M11 13.5l1 1 2-2.5" opacity="0.7"/>'),
  translate: svgIcon('<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2.2 1.8 2.2 10.2 0 12M8 2c-2.2 1.8-2.2 10.2 0 12"/>'),
  savevideo: svgIcon('<rect x="2" y="3" width="12" height="8.5" rx="1"/><path d="M2 5.5h12M5 3v2.5M11 3v2.5" opacity="0.6"/><path d="M8 13v0M6.5 12l1.5 1.5 1.5-1.5"/>'),
  undo: svgIcon('<path d="M4 8h6a3 3 0 0 1 0 6H6"/><path d="M6.5 5L3.5 8l3 3"/>'),
  redo: svgIcon('<path d="M12 8H6a3 3 0 0 0 0 6h4"/><path d="M9.5 5l3 3-3 3"/>'),
  setstart: svgIcon('<path d="M4 2.5v11"/><path d="M13 8H6.5"/><path d="M9 5.5 6.5 8 9 10.5"/>'),
  setend: svgIcon('<path d="M12 2.5v11"/><path d="M3 8h6.5"/><path d="M7 5.5 9.5 8 7 10.5"/>'),
  playcue: svgIcon('<path d="M4 3.5v9l7-4.5z" fill="currentColor" stroke="none"/>'),
  follow: svgIcon('<circle cx="8" cy="8" r="2.5"/><path d="M8 2v2.5M8 11.5V14M2 8h2.5M11.5 8H14"/>'),
  merge: svgIcon('<rect x="3" y="2.5" width="10" height="3.5" rx="1"/><rect x="3" y="10" width="10" height="3.5" rx="1"/><path d="M8 6.2v3.6M6.5 8.2 8 9.8l1.5-1.6"/>'),
  split: svgIcon('<rect x="3" y="2.5" width="10" height="3.5" rx="1"/><rect x="3" y="10" width="10" height="3.5" rx="1"/><path d="M8 9.8V6.2M6.5 7.8 8 6.2l1.5 1.6"/>'),
  search: svgIcon('<circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/>'),
  problems: svgIcon('<path d="M8 2.5 14 13H2z"/><path d="M8 6.5v3M8 11v0"/>'),
};

// Keyboard shortcuts. Each is shown in its button's tooltip and matched in onKeydown. The
// label is what the tooltip shows (Mac uses the command symbol, other platforms spell the
// modifiers); `aria` is the ARIA key-name form for aria-keyshortcuts so assistive tech can
// announce it. Navigation (arrows) and play/pause (space) are handled inline in onKeydown.
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl"; // ⌘ / Ctrl
const SHIFT_LABEL = IS_MAC ? "⇧" : "Shift"; // ⇧ / Shift
const comboLabel = (...parts: string[]): string => (IS_MAC ? parts.join("") : parts.join("+"));
const hasMod = (e: KeyboardEvent): boolean => e.ctrlKey || e.metaKey;

interface Shortcut {
  label: string; // shown in the tooltip, e.g. "⌘S" or "Ctrl+S"
  aria: string; // ARIA key names for aria-keyshortcuts, e.g. "Control+S"
  match: (e: KeyboardEvent) => boolean;
}
const SHORTCUTS: Record<
  "addCue" | "removeCue" | "save" | "saveVideo" | "undo" | "redo" | "find" | "markIn" | "markOut" | "playCue",
  Shortcut
> = {
  find: {
    label: comboLabel(MOD_LABEL, "F"),
    aria: IS_MAC ? "Meta+F" : "Control+F",
    match: (e) => hasMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f",
  },
  markIn: { label: "[", aria: "[", match: (e) => e.key === "[" && !hasMod(e) && !e.altKey },
  markOut: { label: "]", aria: "]", match: (e) => e.key === "]" && !hasMod(e) && !e.altKey },
  playCue: { label: "\\", aria: "\\", match: (e) => e.key === "\\" && !hasMod(e) && !e.altKey },
  undo: {
    label: comboLabel(MOD_LABEL, "Z"),
    aria: IS_MAC ? "Meta+Z" : "Control+Z",
    match: (e) => hasMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z",
  },
  redo: {
    // Ctrl/Cmd+Shift+Z everywhere; also accept Ctrl+Y on Windows/Linux where it's conventional.
    label: comboLabel(MOD_LABEL, SHIFT_LABEL, "Z"),
    aria: IS_MAC ? "Meta+Shift+Z" : "Control+Shift+Z Control+Y",
    match: (e) =>
      hasMod(e) && !e.altKey && ((e.shiftKey && e.key.toLowerCase() === "z") || (!e.shiftKey && !IS_MAC && e.key.toLowerCase() === "y")),
  },
  // Insert has no key on most Macs, so accept Cmd/Ctrl+Enter too and show the fitting label.
  addCue: {
    label: IS_MAC ? comboLabel(MOD_LABEL, "↩") : "Insert", // ⌘↩ on Mac, Insert elsewhere
    aria: IS_MAC ? "Meta+Enter" : "Insert",
    match: (e) =>
      (e.key === "Insert" && !hasMod(e) && !e.altKey) || (hasMod(e) && !e.shiftKey && !e.altKey && e.key === "Enter"),
  },
  // Delete on Windows/Linux; on a Mac the "delete" key reports Backspace, so accept both.
  removeCue: {
    label: "Delete",
    aria: IS_MAC ? "Backspace" : "Delete",
    match: (e) => (e.key === "Delete" || e.key === "Backspace") && !hasMod(e) && !e.altKey,
  },
  save: {
    label: comboLabel(MOD_LABEL, "S"),
    aria: IS_MAC ? "Meta+S" : "Control+S",
    match: (e) => hasMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s",
  },
  saveVideo: {
    label: comboLabel(MOD_LABEL, SHIFT_LABEL, "S"),
    aria: IS_MAC ? "Meta+Shift+S" : "Control+Shift+S",
    match: (e) => hasMod(e) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "s",
  },
};

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
.se-root{--se-bg:#fff;--se-fg:#1a1a1e;--se-muted:#667;--se-border:#e2e4ea;--se-sel:#dbeafe;--se-sel-fg:#0b1220;--se-head:#f6f7f9;--se-warn:#b45309;--se-bad:#b91c1c;--se-accent:#2563eb;
  display:flex;flex-direction:column;height:100%;min-height:0;position:relative;font-family:system-ui,sans-serif;color:var(--se-fg);background:var(--se-bg);font-size:13px;}
.se-toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:6px 8px;border-bottom:1px solid var(--se-border);background:var(--se-head);}
.se-toolbar b{font-size:13px;margin-right:6px;}
.se-toolbar .se-sp{flex:1 1 auto;}
.se-tracks{display:flex;gap:4px;align-items:center;padding:4px 8px;border-bottom:1px solid var(--se-border);background:var(--se-head);overflow-x:auto;flex-shrink:0;}
.se-toolbar{flex-shrink:0;}
.se-track{position:relative;display:flex;align-items:center;gap:4px;padding:3px 4px 3px 10px;border:1px solid var(--se-border);border-radius:6px;background:var(--se-bg);white-space:nowrap;flex-shrink:0;overflow:hidden;}
.se-track-add{flex-shrink:0;}
.se-track.on{border-color:var(--se-accent);background:var(--se-sel);color:var(--se-sel-fg);}
.se-track.busy{border-color:var(--se-accent);}
.se-track-prog{position:absolute;left:0;bottom:0;height:2px;background:var(--se-accent);transition:width .2s linear;pointer-events:none;}
.se-track-name{cursor:pointer;font-size:12px;}
.se-jobstrip{display:none;align-items:center;gap:8px;padding:5px 10px;border-bottom:1px solid var(--se-border);background:var(--se-head);flex-shrink:0;}
.se-jobstrip.on{display:flex;}
.se-jobstrip.err .se-job-fill{background:var(--se-bad);}
.se-jobstrip.err .se-job-label{color:var(--se-bad);}
.se-job-label{font-size:12px;color:var(--se-muted);white-space:nowrap;}
.se-job-bar{flex:1 1 auto;height:6px;border-radius:3px;background:var(--se-border);overflow:hidden;}
.se-job-fill{height:100%;background:var(--se-accent);transition:width .2s linear;}
.se-job-btn{border:1px solid var(--se-border);background:var(--se-bg);color:var(--se-fg);cursor:pointer;width:26px;height:24px;border-radius:6px;font-size:12px;line-height:1;flex-shrink:0;}
.se-job-btn:hover{border-color:var(--se-accent);color:var(--se-accent);}
.se-track-x{border:none;background:none;color:var(--se-muted);cursor:pointer;font-size:14px;line-height:1;padding:0 3px;border-radius:4px;}
.se-track-x:hover{color:var(--se-bad);}
.se-track-add{border:1px dashed var(--se-border);background:none;color:var(--se-muted);cursor:pointer;width:24px;height:24px;border-radius:6px;font-size:15px;line-height:1;}
.se-track-add:hover{border-color:var(--se-accent);color:var(--se-accent);}
.se-btn{font:inherit;padding:4px 9px;border:1px solid var(--se-border);background:var(--se-bg);color:var(--se-fg);border-radius:6px;cursor:pointer;}
.se-btn:hover{border-color:var(--se-accent);}
.se-btn:disabled{opacity:.5;cursor:default;}
.se-iconbtn{display:inline-flex;align-items:center;justify-content:center;padding:5px 7px;color:var(--se-fg);}
.se-iconbtn:hover{color:var(--se-accent);}
.se-iconbtn.on{color:var(--se-accent);background:var(--se-sel);border-color:var(--se-accent);}
.se-iconbtn svg{display:block;}
.se-count{color:var(--se-muted);font-size:12px;}
.se-body{flex:1 1 auto;display:flex;min-height:0;}
.se-left{flex:1 1 55%;display:flex;flex-direction:column;min-width:0;min-height:0;border-right:1px solid var(--se-border);}
.se-right{flex:1 1 45%;display:flex;flex-direction:column;min-width:0;background:#000;position:relative;}
.se-listhead,.se-row{display:grid;grid-template-columns:44px 96px 96px 52px 44px 1fr;align-items:center;gap:6px;padding:0 8px;}
.se-ass .se-listhead,.se-ass .se-row{grid-template-columns:44px 96px 96px 52px 44px 110px 1fr;}
.se-actor{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--se-muted);}
.se-listhead{height:28px;border-bottom:1px solid var(--se-border);color:var(--se-muted);font-size:11px;text-transform:uppercase;letter-spacing:.03em;background:var(--se-head);flex:0 0 auto;}
.se-scroll{flex:1 1 auto;overflow-y:auto;position:relative;}
.se-inner{position:relative;width:100%;}
.se-inner:focus{outline:none;}
.se-row{position:absolute;left:0;right:0;height:${ROW_H}px;border-bottom:1px solid var(--se-border);cursor:pointer;box-sizing:border-box;}
.se-row:hover{background:var(--se-head);}
.se-row.sel{background:var(--se-sel);color:var(--se-sel-fg);}
/* Keyboard focus: ring the selected cue when the list itself is focused. */
.se-inner:focus-visible .se-row.sel{box-shadow:inset 0 0 0 2px var(--se-accent);}
.se-row.playing{box-shadow:inset 3px 0 0 var(--se-accent);}
.se-row.commented .se-text{opacity:.5;font-style:italic;}
.se-row.commented .se-num::after{content:" ⊘";color:var(--se-muted);}
.se-cell{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.se-num{color:var(--se-muted);}
.se-time{font-variant-numeric:tabular-nums;font-size:12px;}
.se-cps.warn{color:var(--se-warn);}
.se-cps.bad{color:var(--se-bad);font-weight:600;}
.se-text{white-space:pre;overflow:hidden;text-overflow:ellipsis;}
.se-detail{flex:0 0 auto;border-top:1px solid var(--se-border);padding:8px;display:flex;flex-direction:column;gap:6px;background:var(--se-head);}
.se-times{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;}
.se-cpsinfo{margin-left:auto;font-size:11px;color:var(--se-muted);font-variant-numeric:tabular-nums;padding-bottom:4px;white-space:nowrap;}
.se-cpsinfo.warn{color:var(--se-warn);}
.se-cpsinfo.bad{color:var(--se-bad);font-weight:600;}
.se-field{display:flex;flex-direction:column;gap:2px;font-size:11px;color:var(--se-muted);}
.se-field input{font:inherit;font-variant-numeric:tabular-nums;padding:3px 6px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);width:110px;}
.se-assbox{display:flex;flex-direction:column;gap:6px;}
.se-assextras{flex-wrap:wrap;}
.se-margins{flex-wrap:wrap;align-items:center;}
.se-grouplabel{font-size:10px;color:var(--se-muted);text-transform:uppercase;letter-spacing:.03em;align-self:center;}
.se-effectgroup{gap:3px;}
.se-effectrow{display:flex;gap:6px;align-items:flex-end;}
.se-effectparams{display:flex;gap:6px;align-items:flex-end;}
.se-effectgroup select,.se-selfield select{font:inherit;padding:3px 6px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);}
.se-numfield input{width:56px;}
.se-actorfield input,.se-effectfield input{width:100px;}
.se-checkfield{flex-direction:row;align-items:center;gap:5px;}
.se-checkfield input{width:auto;}
.se-stylerow{display:flex;gap:4px;align-items:center;}
.se-stylefield select{font:inherit;padding:3px 6px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);}
.se-styleedit{padding:3px 6px;}
.se-detail textarea{font:inherit;min-height:56px;resize:vertical;padding:6px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);}
.se-tabs{display:flex;gap:4px;border-bottom:1px solid var(--se-border);}
.se-tab{font:inherit;padding:4px 12px;border:1px solid transparent;border-bottom:none;border-radius:5px 5px 0 0;background:none;color:var(--se-muted);cursor:pointer;}
.se-tab.on{background:var(--se-bg);color:var(--se-fg);border-color:var(--se-border);}
.se-inlinebar{display:flex;gap:5px;align-items:center;flex-wrap:wrap;}
.se-cgroup{display:flex;align-items:center;gap:4px;padding:2px 6px;border:1px solid var(--se-border);border-radius:6px;}
.se-cglabel{color:var(--se-muted);font-size:11px;}
.se-widthfield{width:44px;font:inherit;padding:2px 4px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);}
.se-alpha{width:54px;}
.se-fontname{width:96px;font:inherit;padding:2px 4px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);}
.se-inbtn{font:600 12px system-ui;width:26px;height:24px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);cursor:pointer;}
.se-inbtn:hover{border-color:var(--se-accent);}
.se-in-i{font-style:italic;}
.se-in-u{text-decoration:underline;}
.se-incolor{width:26px;height:24px;padding:0;border:1px solid var(--se-border);border-radius:5px;background:none;cursor:pointer;}
.se-inalign{font:inherit;height:24px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);}
.se-inbtn.on,.se-posbtn.on{background:var(--se-accent);border-color:var(--se-accent);color:#fff;}
.se-posoverlay{position:absolute;z-index:5;cursor:crosshair;background:rgba(37,99,235,0.08);box-shadow:inset 0 0 0 2px var(--se-accent);}
.se-posdone{position:absolute;top:8px;right:8px;cursor:pointer;font:600 12px system-ui;padding:4px 10px;border:1px solid var(--se-accent);border-radius:6px;background:var(--se-accent);color:#fff;}
.se-poshint{position:absolute;bottom:8px;left:0;right:0;text-align:center;font:600 11px system-ui;color:#fff;text-shadow:0 1px 2px #000;pointer-events:none;}
.se-cliprect{position:absolute;border:1px dashed #fff;background:rgba(255,255,255,0.12);box-shadow:0 0 0 9999px rgba(0,0,0,0.35);pointer-events:none;}
.se-posbar{position:absolute;top:8px;right:8px;display:flex;gap:8px;z-index:1;}
.se-drawcanvas{position:absolute;inset:0;pointer-events:none;}
.se-obtn{cursor:pointer;font:600 12px system-ui;padding:4px 10px;border:1px solid var(--se-border);border-radius:6px;background:var(--se-head);color:var(--se-fg);}
.se-obtn.on,.se-obtn-primary{background:var(--se-accent);border-color:var(--se-accent);color:#fff;}
.se-fadepop{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;padding:6px;border:1px solid var(--se-border);border-radius:6px;background:var(--se-bg);}
.se-fadepop input{width:70px;}
.se-xgroup{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end;padding:4px 8px;border:1px solid var(--se-border);border-radius:6px;}
.se-xgroup .se-xglabel{flex-basis:100%;color:var(--se-muted);font-size:11px;}
.se-xform input{width:56px;}
.se-empty,.se-noprev{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;text-align:center;padding:24px;color:var(--se-muted);}
.se-empty h3{margin:0;color:var(--se-fg);font-size:15px;}
.se-playerhost{flex:1 1 auto;min-height:0;width:100%;height:100%;}
.se-timeline-wrap{flex:0 0 auto;border-top:1px solid var(--se-border);background:var(--se-head);position:relative;}
.se-timeline{touch-action:none;cursor:grab;}
.se-wave-status{position:absolute;top:20px;left:10px;z-index:1;font-size:11px;color:var(--se-muted);pointer-events:none;}
/* --- polish --- */
/* Smooth hover/selection transitions. */
.se-btn,.se-iconbtn,.se-row,.se-tab,.se-inbtn,.se-obtn,.se-job-btn,.se-track,.se-track-x,.se-track-add{transition:background-color .12s ease,border-color .12s ease,color .12s ease,box-shadow .12s ease;}
/* One consistent keyboard-focus ring for every interactive control. Mouse clicks don't show
   it (:focus-visible); the cue list opts out and rings its active row instead. */
.se-root :focus-visible{outline:2px solid var(--se-accent);outline-offset:1px;}
.se-inner:focus-visible{outline:none;}
.se-iconbtn:focus-visible,.se-btn:focus-visible{border-radius:6px;}
/* Slim, theme-aware scrollbar for the cue list. */
.se-scroll{scrollbar-width:thin;scrollbar-color:var(--se-border) transparent;}
.se-scroll::-webkit-scrollbar{width:11px;}
.se-scroll::-webkit-scrollbar-thumb{background:var(--se-border);border-radius:6px;border:3px solid var(--se-bg);}
.se-scroll::-webkit-scrollbar-thumb:hover{background:var(--se-muted);}
/* Non-blocking toast, bottom-center, auto-dismissed (no longer hijacks the cue count). */
.se-toast{position:absolute;left:50%;bottom:18px;transform:translate(-50%,10px);z-index:30;max-width:82%;padding:8px 14px;border-radius:8px;background:var(--se-fg);color:var(--se-bg);font-size:12px;line-height:1.35;box-shadow:0 6px 20px rgba(0,0,0,.28);opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease;}
.se-toast.on{opacity:.96;transform:translate(-50%,0);}
/* Find / replace bar. */
.se-findbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:6px 8px;border-bottom:1px solid var(--se-border);background:var(--se-head);flex-shrink:0;}
.se-findinput{font:inherit;padding:4px 8px;border:1px solid var(--se-border);border-radius:6px;background:var(--se-bg);color:var(--se-fg);min-width:140px;}
.se-findcount{font-size:12px;color:var(--se-muted);font-variant-numeric:tabular-nums;min-width:64px;}
/* Problems panel: floating, top-right of the editor. */
.se-problems{position:absolute;top:8px;right:8px;z-index:25;width:280px;max-height:60%;overflow-y:auto;background:var(--se-bg);border:1px solid var(--se-border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.28);padding:4px;}
.se-prob-empty{padding:14px;text-align:center;color:var(--se-muted);font-size:12px;}
.se-prob-row{display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:12px;}
.se-prob-row:hover,.se-prob-row:focus-visible{background:var(--se-head);outline:none;}
.se-prob-idx{color:var(--se-muted);font-variant-numeric:tabular-nums;min-width:22px;text-align:right;}
.se-prob-msg{color:var(--se-warn);}
@media (prefers-color-scheme: dark){
.se-root{--se-bg:#1c1d21;--se-fg:#e6e7ea;--se-muted:#9aa0aa;--se-border:#33353b;--se-sel:#1e3a5f;--se-sel-fg:#eaf2ff;--se-head:#25272c;--se-warn:#f59e0b;--se-bad:#f87171;--se-accent:#60a5fa;}
}
`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

class SubtitleEditor implements SubtitleEditorHandle {
  private root: HTMLDivElement;
  private tracks: Track[] = [];
  private activeTrackId = "";
  // The active track's document. A get/set accessor keeps the rest of the editor, which was
  // written against a single `this.doc`, working unchanged.
  private get doc(): SubtitleDoc {
    return (this.tracks.find((t) => t.id === this.activeTrackId) ?? this.tracks[0]).doc;
  }
  private set doc(v: SubtitleDoc) {
    const tr = this.tracks.find((t) => t.id === this.activeTrackId);
    if (tr) tr.doc = v;
  }
  private opts: SubtitleEditorOptions;
  private selectedId: string | null = null;
  private playingId: string | null = null;

  private scrollEl!: HTMLDivElement;
  private innerEl!: HTMLDivElement;
  private detailEl!: HTMLDivElement;
  private countEl!: HTMLSpanElement;
  private stylesBtn!: HTMLButtonElement;
  private scriptBtn!: HTMLButtonElement;
  private fmtSel!: HTMLSelectElement;
  private trackBar!: HTMLDivElement;
  private jobStrip!: HTMLDivElement;
  private previewPushTimer: number | null = null;
  private leftEl!: HTMLDivElement;
  private headEl!: HTMLDivElement;
  private rightEl!: HTMLDivElement;
  private player: MediaPlayerHandle | null = null;
  private video: HTMLMediaElement | null = null;
  private mediaFile: File | null = null; // the original file; streamed from disk (never held whole in RAM)
  private mediaContainer: "mkv" | "mp4" = "mp4"; // detected at load, for save-into-video
  private timeline: Timeline | null = null;
  private waveAbort: AbortController | null = null;
  private waveStatusEl: HTMLDivElement | null = null;
  private detailTextarea: HTMLTextAreaElement | null = null;
  private detailTab: "text" | "drawing" = "text";
  private posOverlay: HTMLDivElement | null = null;
  private positionCueId: string | null = null;
  private clipOverlay: HTMLDivElement | null = null;
  private drawOverlay: HTMLDivElement | null = null;
  private wavePeaks: { peaks: Float32Array; peaksPerSec: number } | null = null;
  private rows = new Map<string, HTMLDivElement>();
  private rafPending = false;
  private subtitleTimer = 0;

  // Undo/redo. The whole editable model (all tracks + selection) is snapshotted; edits within
  // a short window coalesce into one step (so typing a word is one undo, not one per key).
  private undoStack: HistorySnap[] = [];
  private redoStack: HistorySnap[] = [];
  private histBaseline: HistorySnap | null = null;
  private histTimer = 0;
  private restoring = false;
  private undoBtn: HTMLButtonElement | null = null;
  private redoBtn: HTMLButtonElement | null = null;
  private followBtn: HTMLButtonElement | null = null;
  private followPlayback = true;
  private problemsBtn: HTMLButtonElement | null = null;
  private findBar: HTMLDivElement | null = null;
  private findInput: HTMLInputElement | null = null;
  private findReplaceInput: HTMLInputElement | null = null;
  private findCountEl: HTMLSpanElement | null = null;
  private findMatches: string[] = []; // ids of cues matching the current query
  private findPos = -1;
  private problemsPanel: HTMLDivElement | null = null;

  constructor(container: HTMLElement, input: SubtitleInput, opts: SubtitleEditorOptions) {
    this.opts = opts;
    if (opts.locale) setLocale(opts.locale);
    injectStyles();
    const meta = deriveTrackMeta(input.filename);
    this.tracks = [{ id: newTrackId(), label: meta.label, language: meta.language, doc: parseSubtitles(input.text, input.filename) }];
    this.activeTrackId = this.tracks[0].id;

    this.root = document.createElement("div");
    this.root.className = "se-root";
    this.root.tabIndex = 0;
    container.appendChild(this.root);

    this.buildToolbar();
    this.buildTrackBar();
    this.buildBody();
    this.renderList();
    this.renderDetail();
    if (this.doc.cues.length) this.select(this.doc.cues[0].id);

    this.histBaseline = this.snapshot(); // the loaded document is the initial undo baseline
    this.root.addEventListener("keydown", this.onKeydown);
  }

  // --- structure -----------------------------------------------------------

  private buildToolbar(): void {
    const bar = el("div", "se-toolbar");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", t("toolbarLabel"));

    this.undoBtn = this.iconButton(ICON.undo, t("undo"), () => this.undo(), SHORTCUTS.undo);
    this.redoBtn = this.iconButton(ICON.redo, t("redo"), () => this.redo(), SHORTCUTS.redo);
    this.undoBtn.disabled = true;
    this.redoBtn.disabled = true;
    bar.appendChild(this.undoBtn);
    bar.appendChild(this.redoBtn);

    bar.appendChild(this.iconButton(ICON.add, t("addCue"), () => this.addCue(), SHORTCUTS.addCue));
    bar.appendChild(this.iconButton(ICON.remove, t("removeCue"), () => this.removeCue(), SHORTCUTS.removeCue));
    bar.appendChild(this.iconButton(ICON.merge, t("mergeCue"), () => this.mergeCue()));
    bar.appendChild(this.iconButton(ICON.split, t("splitCue"), () => this.splitCue()));
    bar.appendChild(this.iconButton(ICON.search, t("findReplace"), () => this.toggleFind(), SHORTCUTS.find));
    this.problemsBtn = this.iconButton(ICON.problems, t("problems"), () => this.toggleProblems());
    bar.appendChild(this.problemsBtn);
    bar.appendChild(this.iconButton(ICON.shift, t("shiftTimes"), () => this.shiftTimes()));
    bar.appendChild(this.iconButton(ICON.overlaps, t("fixOverlaps"), () => this.fixOverlaps()));

    // Video-timing tools: set the selected cue's start/end to the playhead, play from the cue,
    // and toggle the list auto-scrolling to follow playback.
    bar.appendChild(this.iconButton(ICON.setstart, t("setStartAtPlayhead"), () => this.setCueEdge("start"), SHORTCUTS.markIn));
    bar.appendChild(this.iconButton(ICON.setend, t("setEndAtPlayhead"), () => this.setCueEdge("end"), SHORTCUTS.markOut));
    bar.appendChild(this.iconButton(ICON.playcue, t("playFromCue"), () => this.playFromSelected(), SHORTCUTS.playCue));
    this.followBtn = this.iconButton(ICON.follow, t("followPlayback"), () => this.toggleFollow());
    this.followBtn.classList.toggle("on", this.followPlayback);
    bar.appendChild(this.followBtn);

    const fmt = document.createElement("select");
    fmt.className = "se-btn";
    for (const f of ["srt", "vtt", "ass"] as SubtitleFormat[]) {
      const o = document.createElement("option");
      o.value = f;
      o.textContent = f.toUpperCase();
      fmt.appendChild(o);
    }
    fmt.value = this.doc.format;
    fmt.title = t("format");
    fmt.setAttribute("aria-label", t("format"));
    fmt.addEventListener("change", () => this.setFormat(fmt.value as SubtitleFormat));
    this.fmtSel = fmt;
    bar.appendChild(fmt);

    // New ASS style (ASS only); edit lives next to the per-cue style dropdown.
    this.stylesBtn = this.iconButton(ICON.styles, t("addStyle"), () => this.addStyle());
    this.stylesBtn.style.display = this.doc.format === "ass" ? "" : "none";
    bar.appendChild(this.stylesBtn);

    // Script properties (ASS only).
    this.scriptBtn = this.iconButton(ICON.script, t("scriptProps"), () =>
      openScriptProperties({ getDoc: () => this.doc, onChange: () => this.markDirty() }),
    );
    this.scriptBtn.style.display = this.doc.format === "ass" ? "" : "none";
    bar.appendChild(this.scriptBtn);

    bar.appendChild(this.iconButton(ICON.transcribe, t("autoTranscribe"), () => this.openTranscribe()));
    bar.appendChild(this.iconButton(ICON.translate, t("translateTrack"), () => this.openTranslate()));
    bar.appendChild(this.iconButton(ICON.savevideo, t("saveVideo"), () => this.saveIntoVideo(), SHORTCUTS.saveVideo));

    const sp = el("span", "se-sp");
    bar.appendChild(sp);

    this.countEl = el("span", "se-count") as HTMLSpanElement;
    bar.appendChild(this.countEl);

    if (this.opts.showSave !== false) {
      bar.appendChild(this.iconButton(ICON.save, t("save"), () => this.save(), SHORTCUTS.save));
    }
    this.root.appendChild(bar);
  }

  // --- tracks --------------------------------------------------------------

  private buildTrackBar(): void {
    this.trackBar = el("div", "se-tracks") as HTMLDivElement;
    this.root.appendChild(this.trackBar);
    this.jobStrip = el("div", "se-jobstrip") as HTMLDivElement;
    this.root.appendChild(this.jobStrip);
    this.renderTrackBar();
    this.renderJobStrip();
  }

  private renderTrackBar(): void {
    this.trackBar.textContent = "";
    // A lone track still shows its tab so the "+" (add track) stays discoverable.
    for (const tr of this.tracks) {
      const tab = el("div", "se-track" + (tr.id === this.activeTrackId ? " on" : "") + (tr.job ? " busy" : ""));
      const name = el("span", "se-track-name", tr.language ? `${tr.label} (${tr.language})` : tr.label);
      name.addEventListener("click", () => this.switchTrack(tr.id));
      name.addEventListener("dblclick", () => this.renameTrack(tr.id));
      tab.appendChild(name);
      if (tr.job) {
        const prog = el("div", "se-track-prog");
        prog.style.width = `${Math.round(tr.job.ratio * 100)}%`;
        tab.appendChild(prog);
      }
      if (this.tracks.length > 1) {
        const close = el("button", "se-track-x", "×");
        close.title = t("removeTrack");
        close.addEventListener("click", (e) => {
          e.stopPropagation();
          this.removeTrack(tr.id);
        });
        tab.appendChild(close);
      }
      this.trackBar.appendChild(tab);
    }
    const add = el("button", "se-track-add", "+");
    add.title = t("addTrack");
    add.addEventListener("click", () => this.addEmptyTrack());
    this.trackBar.appendChild(add);
  }

  private switchTrack(id: string): void {
    if (id === this.activeTrackId || !this.tracks.some((t) => t.id === id)) return;
    if (this.posOverlay) this.exitPosition();
    if (this.clipOverlay) this.exitClip();
    if (this.drawOverlay) this.exitDraw();
    this.activeTrackId = id;
    this.selectedId = null;
    this.refreshForActiveDoc();
    this.pushSubtitles();
    this.renderTrackBar();
    this.renderJobStrip();
  }

  private addEmptyTrack(): void {
    let doc = parseSubtitles("", "track.srt");
    if (this.doc.format !== "srt") doc = convertDoc(doc, this.doc.format);
    const id = newTrackId();
    this.tracks.push({ id, label: `${t("track")} ${this.tracks.length + 1}`, language: "", doc });
    this.switchTrack(id);
    this.markDirty();
  }

  private removeTrack(id: string): void {
    if (this.tracks.length <= 1) return;
    const idx = this.tracks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    this.tracks[idx].job?.run?.cancel();
    this.tracks.splice(idx, 1);
    if (this.activeTrackId === id) {
      this.activeTrackId = this.tracks[Math.min(idx, this.tracks.length - 1)].id;
      this.selectedId = null;
      this.refreshForActiveDoc();
      this.pushSubtitles();
    }
    this.renderTrackBar();
    this.markDirty();
  }

  private renameTrack(id: string): void {
    const tr = this.tracks.find((t) => t.id === id);
    if (!tr) return;
    const name = prompt(t("trackNamePrompt"), tr.label);
    if (name != null) {
      tr.label = name.trim() || tr.label;
      this.renderTrackBar();
      this.markDirty();
    }
  }

  // Re-point all views at the active track's document (format UI, list head, list, detail).
  private refreshForActiveDoc(): void {
    const isAss = this.doc.format === "ass";
    this.stylesBtn.style.display = isAss ? "" : "none";
    this.scriptBtn.style.display = isAss ? "" : "none";
    this.leftEl.classList.toggle("se-ass", isAss);
    this.fmtSel.value = this.doc.format;
    this.renderListHead();
    this.rows.clear();
    this.innerEl.textContent = "";
    this.scrollEl.scrollTop = 0;
    this.renderList();
    if (this.doc.cues.length) this.select(this.doc.cues[0].id);
    else this.renderDetail();
  }

  private buildBody(): void {
    const body = el("div", "se-body");
    const left = el("div", "se-left") as HTMLDivElement;
    this.leftEl = left;
    left.classList.toggle("se-ass", this.doc.format === "ass");

    this.headEl = el("div", "se-listhead") as HTMLDivElement;
    left.appendChild(this.headEl);
    this.renderListHead();

    this.scrollEl = el("div", "se-scroll") as HTMLDivElement;
    this.innerEl = el("div", "se-inner") as HTMLDivElement;
    // The cue list is a listbox: rows are options, the selected cue is the active descendant,
    // and Up/Down arrows move the selection (handled in onKeydown).
    this.innerEl.setAttribute("role", "listbox");
    this.innerEl.setAttribute("aria-label", t("cueListLabel"));
    this.innerEl.tabIndex = 0;
    this.scrollEl.appendChild(this.innerEl);
    this.scrollEl.addEventListener("scroll", this.onScroll);
    left.appendChild(this.scrollEl);

    this.detailEl = el("div", "se-detail") as HTMLDivElement;
    left.appendChild(this.detailEl);

    this.rightEl = el("div", "se-right") as HTMLDivElement;
    this.renderPreviewPlaceholder();

    body.appendChild(left);
    body.appendChild(this.rightEl);
    this.root.appendChild(body);

    // Bottom timeline: cue blocks + waveform + playhead, spanning the full width.
    const strip = el("div", "se-timeline-wrap");
    this.waveStatusEl = el("div", "se-wave-status") as HTMLDivElement;
    strip.appendChild(this.waveStatusEl);
    this.root.appendChild(strip);
    this.timeline = new Timeline({
      getCues: () => this.doc.cues,
      getDuration: () => this.video?.duration ?? 0,
      getCurrentTime: () => this.video?.currentTime ?? 0,
      getSelectedId: () => this.selectedId,
      onSeek: (sec) => this.seekTo(sec * 1000),
      onSelectCue: (id) => this.select(id),
      onRetime: (id, startMs, endMs, commit) => this.retimeCue(id, startMs, endMs, commit),
    });
    this.timeline.mount(strip);
  }

  // Drag-retime from the timeline: update the cue live, commit (push + onChange) on release.
  private retimeCue(id: string, startMs: number, endMs: number, commit: boolean): void {
    const cue = this.doc.cues.find((c) => c.id === id);
    if (!cue) return;
    cue.startMs = startMs;
    cue.endMs = endMs;
    this.refreshRow(id);
    if (commit) {
      if (id === this.selectedId) this.renderDetail();
      this.markDirty();
    }
  }

  // --- cue list (virtualized) ----------------------------------------------

  private onScroll = (): void => {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.renderWindow();
    });
  };

  private renderList(): void {
    this.innerEl.style.height = `${this.doc.cues.length * ROW_H}px`;
    this.countEl.textContent = t("cueCount", { n: this.doc.cues.length });
    this.renderWindow();
    if (this.doc.cues.length === 0) this.renderEmptyList();
    this.timeline?.render();
  }

  private renderEmptyList(): void {
    this.rows.clear();
    this.innerEl.textContent = "";
    const empty = el("div", "se-empty");
    empty.style.position = "absolute";
    empty.style.inset = "0";
    empty.appendChild(el("div", "", t("noCues")));
    this.innerEl.appendChild(empty);
  }

  private renderWindow(): void {
    const cues = this.doc.cues;
    if (cues.length === 0) return;
    const scrollTop = this.scrollEl.scrollTop;
    const viewH = this.scrollEl.clientHeight || 400;
    const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
    const last = Math.min(cues.length - 1, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);

    const needed = new Set<string>();
    for (let i = first; i <= last; i += 1) {
      const cue = cues[i];
      needed.add(cue.id);
      let row = this.rows.get(cue.id);
      if (!row) {
        row = this.makeRow(cue);
        this.rows.set(cue.id, row);
        this.innerEl.appendChild(row);
      }
      this.fillRow(row, cue, i);
      row.style.top = `${i * ROW_H}px`;
    }
    // Recycle rows that scrolled out of the window.
    for (const [id, row] of this.rows) {
      if (!needed.has(id)) {
        row.remove();
        this.rows.delete(id);
      }
    }
  }

  // Build the list header, adding an Actor column for ASS.
  private renderListHead(): void {
    this.headEl.textContent = "";
    this.headEl.appendChild(el("div", "se-num", t("colIndex")));
    this.headEl.appendChild(el("div", "", t("colStart")));
    this.headEl.appendChild(el("div", "", t("colEnd")));
    this.headEl.appendChild(el("div", "", t("colDuration")));
    this.headEl.appendChild(el("div", "", t("colCps")));
    if (this.doc.format === "ass") this.headEl.appendChild(el("div", "", t("actor")));
    this.headEl.appendChild(el("div", "", t("colText")));
  }

  private makeRow(cue: Cue): HTMLDivElement {
    const row = el("div", "se-row") as HTMLDivElement;
    row.dataset.id = cue.id;
    row.id = `se-opt-${cue.id}`;
    row.setAttribute("role", "option");
    row.appendChild(el("div", "se-cell se-num"));
    row.appendChild(el("div", "se-cell se-time se-start"));
    row.appendChild(el("div", "se-cell se-time se-end"));
    row.appendChild(el("div", "se-cell se-time se-dur"));
    row.appendChild(el("div", "se-cell se-cps"));
    if (this.doc.format === "ass") row.appendChild(el("div", "se-cell se-actor"));
    row.appendChild(el("div", "se-cell se-text"));
    // Focus the list on click so the keyboard shortcuts (arrows, Insert/⌘Enter, Delete) work
    // immediately after picking a cue with the mouse.
    row.addEventListener("click", () => {
      this.select(cue.id);
      this.innerEl.focus();
    });
    row.addEventListener("dblclick", () => this.seekTo(cue.startMs, true));
    return row;
  }

  private fillRow(row: HTMLDivElement, cue: Cue, index: number): void {
    const sep = this.doc.format === "srt" ? "," : ".";
    const cell = (c: string) => row.querySelector<HTMLElement>(`.${c}`)!;
    cell("se-num").textContent = String(index + 1);
    cell("se-start").textContent = formatTimestamp(cue.startMs, sep);
    cell("se-end").textContent = formatTimestamp(cue.endMs, sep);
    cell("se-dur").textContent = ((cue.endMs - cue.startMs) / 1000).toFixed(1);
    const c = cps(cue);
    const cpsCell = cell("se-cps");
    cpsCell.textContent = c ? c.toFixed(0) : "";
    cpsCell.className = "se-cell se-cps" + (c > CPS_BAD ? " bad" : c > CPS_WARN ? " warn" : "");
    const actorCell = row.querySelector<HTMLElement>(".se-actor");
    if (actorCell) actorCell.textContent = cue.assFields?.Name ?? "";
    cell("se-text").textContent = cue.text.replace(/\n/g, " ⏎ ");
    row.classList.toggle("sel", cue.id === this.selectedId);
    row.classList.toggle("playing", cue.id === this.playingId);
    row.classList.toggle("commented", cue.assKind === "Comment");
    row.setAttribute("aria-selected", String(cue.id === this.selectedId));
    // A spoken description of the cue for screen readers: index, timing, and text.
    const spoken = visibleText(cue.text) || t("noCues");
    row.setAttribute("aria-label", `${index + 1}. ${formatTimestamp(cue.startMs, sep)} – ${formatTimestamp(cue.endMs, sep)}. ${spoken}`);
  }

  private refreshRow(id: string): void {
    const row = this.rows.get(id);
    const index = this.doc.cues.findIndex((c) => c.id === id);
    if (row && index >= 0) this.fillRow(row, this.doc.cues[index], index);
  }

  // --- selection + detail editor -------------------------------------------

  private select(id: string): void {
    if (this.selectedId === id) return;
    if (this.posOverlay) this.exitPosition();
    if (this.clipOverlay) this.exitClip();
    if (this.drawOverlay) this.exitDraw();
    const prev = this.selectedId;
    this.selectedId = id;
    const c = this.doc.cues.find((k) => k.id === id);
    this.detailTab = c && /\\p[1-9]/.test(c.text) ? "drawing" : "text";
    if (prev) this.refreshRow(prev);
    this.refreshRow(id);
    this.innerEl.setAttribute("aria-activedescendant", `se-opt-${id}`);
    this.scrollSelectedIntoView();
    this.renderDetail();
    this.timeline?.render();
  }

  private scrollSelectedIntoView(): void {
    if (this.selectedId) this.scrollCueIntoView(this.selectedId);
  }

  private renderDetail(): void {
    this.detailEl.textContent = "";
    const cue = this.selectedCue();
    if (!cue) {
      this.detailEl.appendChild(el("div", "se-count", t("selectCue")));
      return;
    }
    const sep = this.doc.format === "srt" ? "," : ".";
    const times = el("div", "se-times");
    times.appendChild(
      this.timeField(t("start"), formatTimestamp(cue.startMs, sep), (v) => {
        const ms = parseTimestamp(v);
        if (!Number.isNaN(ms)) this.updateCue(cue.id, { startMs: ms });
      }),
    );
    times.appendChild(
      this.timeField(t("end"), formatTimestamp(cue.endMs, sep), (v) => {
        const ms = parseTimestamp(v);
        if (!Number.isNaN(ms)) this.updateCue(cue.id, { endMs: ms });
      }),
    );
    times.appendChild(
      this.timeField(t("duration"), ((cue.endMs - cue.startMs) / 1000).toFixed(3), (v) => {
        const secs = parseFloat(v);
        if (!Number.isNaN(secs)) this.updateCue(cue.id, { endMs: cue.startMs + Math.round(secs * 1000) });
      }),
    );
    if (this.doc.format === "ass") times.appendChild(this.styleField(cue));
    // Live reading-speed feedback for the selected cue, right-aligned in the times row.
    this.cpsInfoEl = el("div", "se-cpsinfo");
    times.appendChild(this.cpsInfoEl);
    this.updateCpsInfo(cue);
    this.detailEl.appendChild(times);
    if (this.doc.format === "ass") this.detailEl.appendChild(this.assExtrasRow(cue));

    const ta = this.makeTextarea(cue);
    if (this.doc.format === "ass") {
      // Text / Drawing tabs: each shows only its relevant tools.
      const tabs = el("div", "se-tabs");
      const mkTab = (id: "text" | "drawing", label: string) => {
        const b = el("button", "se-tab" + (this.detailTab === id ? " on" : ""), label);
        b.addEventListener("click", () => {
          this.detailTab = id;
          this.renderDetail();
        });
        return b;
      };
      tabs.append(mkTab("text", t("tabText")), mkTab("drawing", t("tabDrawing")));
      this.detailEl.appendChild(tabs);
      this.detailEl.appendChild(this.inlineToolbar(cue, ta, this.detailTab));
    }
    this.detailEl.appendChild(ta);
  }

  private makeTextarea(cue: Cue): HTMLTextAreaElement {
    const ta = document.createElement("textarea");
    ta.value = cue.text;
    ta.spellcheck = false;
    this.detailTextarea = ta;
    ta.addEventListener("input", () => {
      this.updateCue(cue.id, { text: ta.value }, /*fromText*/ true);
      this.updateCpsInfo(cue); // text edits don't re-render the detail, so refresh the readout
    });
    return ta;
  }

  private cpsInfoEl: HTMLElement | null = null;

  // Show the selected cue's reading speed and visible-character count, coloured like the list.
  private updateCpsInfo(cue: Cue): void {
    if (!this.cpsInfoEl) return;
    const c = cps(cue);
    const chars = visibleText(cue.text).length;
    this.cpsInfoEl.textContent = t("cpsChars", { cps: c ? c.toFixed(0) : "0", chars: String(chars) });
    this.cpsInfoEl.className = "se-cpsinfo" + (c > CPS_BAD ? " bad" : c > CPS_WARN ? " warn" : "");
  }

  // --- colours (whole-cue \1c fill / \3c border / \4c shadow-or-box) --------

  private cueColorHex(cue: Cue, tag: string, styleField: string): string {
    const m = cue.text.match(new RegExp(`\\\\${tag}&H([0-9A-Fa-f]{6})&`));
    if (m) {
      const h = m[1];
      return `#${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toLowerCase();
    }
    const style = this.doc.styles?.find((s) => s.name === (cue.assFields?.Style ?? "Default"));
    return assColorToHex(style?.fields[styleField] ?? "&H00FFFFFF").hex;
  }

  private setCueColor(cue: Cue, ta: HTMLTextAreaElement, tag: string, hex: string): void {
    const m = hex.match(/^#?([0-9a-f]{6})$/i);
    const h = m ? m[1] : "ffffff";
    const bgr = (h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2)).toUpperCase();
    const stripped = cue.text.replace(new RegExp(`\\\\${tag}&H[0-9A-Fa-f]+&`, "g"), "").replace(/\{\}/g, "");
    ta.value = `{\\${tag}&H${bgr}&}` + stripped;
    this.updateCue(cue.id, { text: ta.value }, true);
  }

  // A boxed area pairing a colour swatch with an opacity slider and an optional width
  // field, under one label (Fill / Border / Shadow) so it reads as a single control.
  private colorGroup(cue: Cue, ta: HTMLTextAreaElement, label: string, colorTag: string, alphaTag: string, styleField: string, colorTitle: string, widthTag?: string): HTMLElement {
    const g = el("div", "se-cgroup");
    g.appendChild(el("span", "se-cglabel", label));
    g.appendChild(this.colorButton(cue, ta, colorTag, styleField, colorTitle));
    g.appendChild(this.alphaSlider(cue, ta, alphaTag, styleField));
    if (widthTag) g.appendChild(this.numField(cue, ta, widthTag, widthTag === "shad" ? t("tipShadowWidthField") : t("tipBorderWidthField")));
    return g;
  }

  // Opacity slider (0..100%) writing the alpha override (\1a/\3a/\4a). ASS alpha is
  // inverted (&H00 opaque, &HFF transparent), so 100% == &H00.
  private alphaSlider(cue: Cue, ta: HTMLTextAreaElement, alphaTag: string, styleField: string): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "range";
    input.className = "se-alpha";
    input.min = "0";
    input.max = "100";
    const m = cue.text.match(new RegExp(`\\\\${alphaTag}&H([0-9A-Fa-f]{2})&`));
    const style = this.doc.styles?.find((s) => s.name === (cue.assFields?.Style ?? "Default"));
    const aa = m ? m[1] : assColorToHex(style?.fields[styleField] ?? "&H00FFFFFF").alpha;
    const pct = Math.round((1 - parseInt(aa || "00", 16) / 255) * 100);
    input.value = String(pct);
    input.title = t("tipOpacity");
    input.addEventListener("input", () => {
      const hex = Math.round((1 - Number(input.value) / 100) * 255).toString(16).padStart(2, "0").toUpperCase();
      const stripped = cue.text.replace(new RegExp(`\\\\${alphaTag}&H[0-9A-Fa-f]+&`, "g"), "").replace(/\{\}/g, "");
      ta.value = `{\\${alphaTag}&H${hex}&}` + stripped;
      this.updateCue(cue.id, { text: ta.value }, true);
    });
    return input;
  }

  // Per-span font: name (\fn) and size (\fs), defaulting from the cue's style. The name
  // input offers used and embedded fonts as suggestions.
  private fontGroup(cue: Cue, ta: HTMLTextAreaElement): HTMLElement {
    const g = el("div", "se-cgroup");
    g.appendChild(el("span", "se-cglabel", t("styleFont")));
    const style = this.doc.styles?.find((s) => s.name === (cue.assFields?.Style ?? "Default"));
    const name = document.createElement("input");
    name.type = "text";
    name.className = "se-fontname";
    name.title = t("tipFontName");
    name.setAttribute("list", "se-spanfontlist");
    name.placeholder = style?.fields.Fontname ?? "";
    name.value = cue.text.match(/\\fn([^\\}]+)/)?.[1]?.trim() ?? "";
    name.addEventListener("change", () => {
      const stripped = cue.text.replace(/\\fn[^\\}]*/g, "").replace(/\{\}/g, "");
      ta.value = name.value.trim() === "" ? stripped : `{\\fn${name.value.trim()}}` + stripped;
      this.updateCue(cue.id, { text: ta.value }, true);
    });
    g.append(name, this.fontDatalist(), this.numField(cue, ta, "fs", t("tipFontSize")));
    return g;
  }

  private fontDatalist(): HTMLDataListElement {
    const dl = document.createElement("datalist");
    dl.id = "se-spanfontlist";
    const fonts = new Set<string>();
    for (const s of this.doc.styles ?? []) if (s.fields.Fontname) fonts.add(s.fields.Fontname);
    for (const f of embeddedFontNames(this.doc)) fonts.add(f);
    for (const f of ["Arial", "Helvetica", "Times New Roman", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Courier New", "Comic Sans MS"]) fonts.add(f);
    for (const f of fonts) {
      const o = document.createElement("option");
      o.value = f;
      dl.appendChild(o);
    }
    return dl;
  }

  private colorButton(cue: Cue, ta: HTMLTextAreaElement, tag: string, styleField: string, title: string): HTMLElement {
    const input = document.createElement("input");
    input.type = "color";
    input.className = "se-incolor";
    input.title = title;
    input.value = this.cueColorHex(cue, tag, styleField);
    input.addEventListener("input", () => this.setCueColor(cue, ta, tag, input.value));
    return input;
  }

  // The per-cue tool row. In "text" mode it shows text formatting (B/I/U, fade, karaoke,
  // alignment); in "drawing" mode it shows shape tools (edit shape, border width). Colours,
  // transform, position and clip apply to both.
  private inlineToolbar(cue: Cue, ta: HTMLTextAreaElement, mode: "text" | "drawing"): HTMLElement {
    const bar = el("div", "se-inlinebar");
    const wrap = (before: string, after: string): void => {
      const s = ta.selectionStart ?? ta.value.length;
      const e = ta.selectionEnd ?? s;
      ta.value = ta.value.slice(0, s) + before + ta.value.slice(s, e) + after + ta.value.slice(e);
      ta.focus();
      ta.setSelectionRange(s + before.length, e + before.length);
      this.updateCue(cue.id, { text: ta.value }, true);
    };
    const iconBtn = (html: string, title: string, fn: () => void, extra = ""): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `se-inbtn ${extra}`;
      b.innerHTML = html;
      b.title = title;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", fn);
      return b;
    };

    if (mode === "text") {
      const tagBtn = (label: string, on: string, off: string, cls: string, tip: string) => {
        const b = iconBtn("", tip, () => wrap(`{\\${on}}`, `{\\${off}}`), cls);
        b.textContent = label;
        return b;
      };
      bar.append(
        tagBtn("B", "b1", "b0", "se-in-b", t("tipBold")),
        tagBtn("I", "i1", "i0", "se-in-i", t("tipItalic")),
        tagBtn("U", "u1", "u0", "se-in-u", t("tipUnderline")),
      );
      bar.appendChild(this.fontGroup(cue, ta));
    }

    // Fill / border / shadow, each grouping its colour with its width. Applies to
    // drawings and text alike (an ASS shape is outlined and shadowed like glyphs are).
    bar.append(
      this.colorGroup(cue, ta, t("fill"), "1c", "1a", "PrimaryColour", t("tipColorFill")),
      this.colorGroup(cue, ta, t("borderWidth"), "3c", "3a", "OutlineColour", t("tipColorBorder"), "bord"),
      this.colorGroup(cue, ta, t("shadowWidth"), "4c", "4a", "BackColour", t("tipColorBack"), "shad"),
    );

    if (mode === "drawing") {
      bar.appendChild(iconBtn(ICON.draw, t("tipEditShape"), () => this.toggleDraw(cue), "se-posbtn" + (this.drawOverlay ? " on" : "")));
    }

    // Fade and transform apply to both text and drawings; karaoke is text-only.
    bar.appendChild(iconBtn(ICON.fade, t("tipFade"), () => this.openFade(cue, ta)));
    if (mode === "text") {
      bar.appendChild(
        iconBtn(ICON.mic, t("tipKaraoke"), () =>
          openKaraoke(cue, this.video ?? null, this.wavePeaks, this.cueColorHex(cue, "2c", "SecondaryColour"), (text) => {
            ta.value = text;
            this.updateCue(cue.id, { text }, true);
          }),
        ),
      );
    }

    bar.appendChild(iconBtn(ICON.transform, t("tipTransform"), () => this.openTransform(cue, ta)));

    if (mode === "text") {
      const align = document.createElement("select");
      align.className = "se-inalign";
      align.title = t("tipAlign");
      const optNone = document.createElement("option");
      optNone.value = "none";
      optNone.textContent = t("noAlign");
      align.appendChild(optNone);
      for (const { value, label } of alignmentOptions()) {
        const o = document.createElement("option");
        o.value = value;
        o.textContent = label;
        align.appendChild(o);
      }
      align.value = cue.text.match(/\\an([1-9])/)?.[1] ?? "none";
      align.addEventListener("change", () => {
        const stripped = cue.text.replace(/\{\\an[1-9]\}/g, "").replace(/\\an[1-9]/g, "").replace(/\{\}/g, "");
        ta.value = align.value === "none" ? stripped : `{\\an${align.value}}` + stripped;
        this.updateCue(cue.id, { text: ta.value }, true);
        this.renderDetail();
      });
      bar.appendChild(align);

      // Wrap style (\q): how libass breaks the line. "Default" removes the override.
      const wrap = document.createElement("select");
      wrap.className = "se-inalign";
      wrap.title = t("tipWrap");
      for (const { value, label } of [
        { value: "none", label: t("wrapDefault") },
        { value: "0", label: t("wrapSmart") },
        { value: "1", label: t("wrapEol") },
        { value: "2", label: t("wrapNone") },
        { value: "3", label: t("wrapSmartLow") },
      ]) {
        const o = document.createElement("option");
        o.value = value;
        o.textContent = label;
        wrap.appendChild(o);
      }
      wrap.value = cue.text.match(/\\q([0-3])/)?.[1] ?? "none";
      wrap.addEventListener("change", () => {
        const stripped = cue.text.replace(/\{\\q[0-3]\}/g, "").replace(/\\q[0-3]/g, "").replace(/\{\}/g, "");
        ta.value = wrap.value === "none" ? stripped : `{\\q${wrap.value}}` + stripped;
        this.updateCue(cue.id, { text: ta.value }, true);
      });
      bar.appendChild(wrap);
    }

    bar.appendChild(iconBtn("⌖", t("tipPosition"), () => this.togglePosition(cue), "se-posbtn" + (this.positionCueId === cue.id ? " on" : "")));
    bar.appendChild(iconBtn(ICON.clip, t("tipClip"), () => this.toggleClip(cue), "se-posbtn" + (this.clipOverlay ? " on" : "")));
    return bar;
  }

  // A numeric override field, e.g. border width (\bord) or shadow depth (\shad).
  private numField(cue: Cue, ta: HTMLTextAreaElement, tag: string, title: string): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "number";
    input.className = "se-widthfield";
    input.min = "0";
    input.step = "0.5";
    input.title = title;
    input.placeholder = title;
    input.value = cue.text.match(new RegExp(`\\\\${tag}([\\d.]+)`))?.[1] ?? "";
    input.addEventListener("change", () => {
      const stripped = cue.text.replace(new RegExp(`\\\\${tag}[\\d.]+`, "g"), "").replace(/\{\}/g, "");
      ta.value = input.value === "" ? stripped : `{\\${tag}${input.value}}` + stripped;
      this.updateCue(cue.id, { text: ta.value }, true);
    });
    return input;
  }

  // --- position picker (\pos via clicking the preview) ---------------------

  // The video's on-screen content box (accounting for letterbox), in viewport coords.
  private videoContentRect(): { left: number; top: number; width: number; height: number } {
    const rect = this.video!.getBoundingClientRect();
    const vid = this.video as HTMLVideoElement;
    const vW = vid.videoWidth || rect.width;
    const vH = vid.videoHeight || rect.height;
    const scale = Math.min(rect.width / vW, rect.height / vH) || 1;
    const width = vW * scale;
    const height = vH * scale;
    return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
  }

  private togglePosition(cue: Cue): void {
    if (this.posOverlay) {
      this.exitPosition();
      return;
    }
    if (this.clipOverlay) this.exitClip();
    if (this.drawOverlay) this.exitDraw();
    if (!this.video) {
      this.toast(t("posNeedsVideo"));
      return;
    }
    this.positionCueId = cue.id;
    const ov = el("div", "se-posoverlay") as HTMLDivElement;
    ov.title = t("positionPick");
    // Cover only the video's content box so only clicks on the picture set a position.
    const cr = this.videoContentRect();
    const rr = this.rightEl.getBoundingClientRect();
    ov.style.left = `${cr.left - rr.left}px`;
    ov.style.top = `${cr.top - rr.top}px`;
    ov.style.width = `${cr.width}px`;
    ov.style.height = `${cr.height}px`;
    // Click sets a static \pos; drag turns it into a \move (the line animates from where
    // you pressed to where you release). The subtitle follows the cursor live during drag.
    let down: { x: number; y: number; moved: boolean } | null = null;
    const cur = () => this.doc.cues.find((k) => k.id === this.positionCueId);
    ov.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY, moved: false };
      ov.setPointerCapture(e.pointerId);
      const c = cur();
      if (c) this.setCuePosition(c, e.clientX, e.clientY);
    });
    ov.addEventListener("pointermove", (e) => {
      if (!down || !(e.buttons & 1)) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true;
      const c = cur();
      if (c) this.setCuePosition(c, e.clientX, e.clientY); // live follow
    });
    ov.addEventListener("pointerup", (e) => {
      const c = cur();
      if (down && down.moved && c) this.setCueMove(c, down.x, down.y, e.clientX, e.clientY);
      down = null;
    });
    // Explicit "Done" affordance (plus Esc and the toolbar toggle) to leave the mode.
    const done = document.createElement("button");
    done.className = "se-posdone";
    done.textContent = t("done");
    done.addEventListener("pointerdown", (e) => e.stopPropagation());
    done.addEventListener("click", () => this.exitPosition());
    const hint = el("div", "se-poshint", t("moveHint"));
    ov.append(done, hint);
    this.rightEl.appendChild(ov);
    this.posOverlay = ov;
    document.addEventListener("keydown", this.onPosKey, true);
    this.renderDetail(); // highlight the toggle
  }

  private onPosKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this.posOverlay) {
      e.preventDefault();
      this.exitPosition();
    }
  };

  private exitPosition(): void {
    document.removeEventListener("keydown", this.onPosKey, true);
    this.posOverlay?.remove();
    this.posOverlay = null;
    this.positionCueId = null;
    this.renderDetail();
  }

  // Map a viewport point to PlayRes coordinates, or null if outside the picture.
  private clientToPlayRes(clientX: number, clientY: number): { px: number; py: number } | null {
    if (!this.video) return null;
    const cr = this.videoContentRect();
    const nx = (clientX - cr.left) / cr.width;
    const ny = (clientY - cr.top) / cr.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
    const res = getPlayRes(this.doc);
    return { px: Math.round(nx * res.x), py: Math.round(ny * res.y) };
  }

  private applyCueTag(cue: Cue, tag: string): void {
    const stripped = cue.text.replace(/\\(pos|move)\([^)]*\)/g, "").replace(/\{\}/g, "");
    cue.text = `{${tag}}` + stripped;
    if (this.detailTextarea) this.detailTextarea.value = cue.text;
    this.refreshRow(cue.id);
    this.markDirty();
  }

  private setCuePosition(cue: Cue, clientX: number, clientY: number): void {
    const p = this.clientToPlayRes(clientX, clientY);
    if (p) this.applyCueTag(cue, `\\pos(${p.px},${p.py})`);
  }

  private setCueMove(cue: Cue, x1: number, y1: number, x2: number, y2: number): void {
    const a = this.clientToPlayRes(x1, y1);
    const b = this.clientToPlayRes(x2, y2);
    if (a && b) this.applyCueTag(cue, `\\move(${a.px},${a.py},${b.px},${b.py})`);
  }

  // --- clip (\clip / \iclip via dragging a rectangle) ----------------------

  private toggleClip(cue: Cue): void {
    if (this.clipOverlay) {
      this.exitClip();
      return;
    }
    if (this.posOverlay) this.exitPosition();
    if (this.drawOverlay) this.exitDraw();
    if (!this.video) {
      this.toast(t("posNeedsVideo"));
      return;
    }
    const ov = el("div", "se-posoverlay se-clipoverlay") as HTMLDivElement;
    const cr = this.videoContentRect();
    const rr = this.rightEl.getBoundingClientRect();
    ov.style.left = `${cr.left - rr.left}px`;
    ov.style.top = `${cr.top - rr.top}px`;
    ov.style.width = `${cr.width}px`;
    ov.style.height = `${cr.height}px`;
    const band = el("div", "se-cliprect");
    band.style.display = "none";
    let inverse = /\\iclip\(/.test(cue.text);
    const bar = el("div", "se-posbar");
    const inv = document.createElement("button");
    inv.className = "se-obtn" + (inverse ? " on" : "");
    inv.textContent = t("inverse");
    inv.addEventListener("pointerdown", (e) => e.stopPropagation());
    inv.addEventListener("click", (e) => {
      e.stopPropagation();
      inverse = !inverse;
      inv.classList.toggle("on", inverse);
    });
    const done = document.createElement("button");
    done.className = "se-obtn se-obtn-primary";
    done.textContent = t("done");
    done.addEventListener("pointerdown", (e) => e.stopPropagation());
    done.addEventListener("click", () => this.exitClip());
    bar.append(inv, done);
    const hint = el("div", "se-poshint", t("clipHint"));
    let start: { x: number; y: number } | null = null;
    const updateBand = (cx: number, cy: number) => {
      const r = ov.getBoundingClientRect();
      band.style.display = "block";
      band.style.left = `${Math.min(start!.x, cx) - r.left}px`;
      band.style.top = `${Math.min(start!.y, cy) - r.top}px`;
      band.style.width = `${Math.abs(cx - start!.x)}px`;
      band.style.height = `${Math.abs(cy - start!.y)}px`;
    };
    ov.addEventListener("pointerdown", (e) => {
      start = { x: e.clientX, y: e.clientY };
      ov.setPointerCapture(e.pointerId);
      updateBand(e.clientX, e.clientY);
    });
    ov.addEventListener("pointermove", (e) => {
      if (start && e.buttons & 1) updateBand(e.clientX, e.clientY);
    });
    ov.addEventListener("pointerup", (e) => {
      if (start && (Math.abs(e.clientX - start.x) > 4 || Math.abs(e.clientY - start.y) > 4)) {
        this.setCueClip(cue, start.x, start.y, e.clientX, e.clientY, inverse);
      }
      start = null;
    });
    ov.append(band, bar, hint);
    this.rightEl.appendChild(ov);
    this.clipOverlay = ov;
    document.addEventListener("keydown", this.onClipKey, true);
    this.renderDetail();
  }

  private onClipKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this.clipOverlay) {
      e.preventDefault();
      this.exitClip();
    }
  };

  private exitClip(): void {
    document.removeEventListener("keydown", this.onClipKey, true);
    this.clipOverlay?.remove();
    this.clipOverlay = null;
    this.renderDetail();
  }

  private setCueClip(cue: Cue, x1: number, y1: number, x2: number, y2: number, inverse: boolean): void {
    const a = this.clientToPlayRes(Math.min(x1, x2), Math.min(y1, y2));
    const b = this.clientToPlayRes(Math.max(x1, x2), Math.max(y1, y2));
    if (!a || !b) return;
    const tag = inverse ? "iclip" : "clip";
    const stripped = cue.text.replace(/\\i?clip\([^)]*\)/g, "").replace(/\{\}/g, "");
    cue.text = `{\\${tag}(${a.px},${a.py},${b.px},${b.py})}` + stripped;
    if (this.detailTextarea) this.detailTextarea.value = cue.text;
    this.refreshRow(cue.id);
    this.markDirty();
  }

  // --- vector drawing (\p): click points on the preview to build a shape ---

  private toggleDraw(cue: Cue): void {
    if (this.drawOverlay) {
      this.exitDraw();
      return;
    }
    if (this.posOverlay) this.exitPosition();
    if (this.clipOverlay) this.exitClip();
    if (!this.video) {
      this.toast(t("posNeedsVideo"));
      return;
    }
    const ov = el("div", "se-posoverlay se-drawoverlay") as HTMLDivElement;
    const cr = this.videoContentRect();
    const rr = this.rightEl.getBoundingClientRect();
    ov.style.left = `${cr.left - rr.left}px`;
    ov.style.top = `${cr.top - rr.top}px`;
    ov.style.width = `${cr.width}px`;
    ov.style.height = `${cr.height}px`;
    const canvas = document.createElement("canvas");
    canvas.className = "se-drawcanvas";
    canvas.width = Math.round(cr.width);
    canvas.height = Math.round(cr.height);
    const ctx = canvas.getContext("2d")!;
    const res = getPlayRes(this.doc);
    const toLocal = (px: number, py: number) => ({ x: (px / res.x) * canvas.width, y: (py / res.y) * canvas.height });
    const toPlay = (x: number, y: number) => ({ px: Math.round((x / canvas.width) * res.x), py: Math.round((y / canvas.height) * res.y) });

    const nodes: DrawNode[] = this.parseDrawing(cue); // existing shape, if any
    let selected = nodes.length ? nodes.length - 1 : -1;
    let drag: { index: number; part: "anchor" | "c1" | "c2" } | null = null;
    const HIT = 8;

    const redraw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!nodes.length) return;
      const L = (n: { px: number; py: number }) => toLocal(n.px, n.py);
      ctx.beginPath();
      const p0 = L(nodes[0]);
      ctx.moveTo(p0.x, p0.y);
      for (const n of nodes.slice(1)) {
        const p = L(n);
        if (n.type === "b" && n.c1 && n.c2) {
          const c1 = L(n.c1);
          const c2 = L(n.c2);
          ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
        } else ctx.lineTo(p.x, p.y);
      }
      if (nodes.length > 2) ctx.closePath();
      ctx.fillStyle = "rgba(96,165,250,0.35)";
      ctx.strokeStyle = "#60a5fa";
      ctx.lineWidth = 1.5;
      if (nodes.length > 2) ctx.fill();
      ctx.stroke();
      // Control handles for bezier nodes.
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      nodes.forEach((n) => {
        if (n.type === "b" && n.c1 && n.c2) {
          const p = L(n);
          for (const c of [L(n.c1), L(n.c2)]) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(c.x, c.y);
            ctx.stroke();
            ctx.fillStyle = "#fde68a";
            ctx.fillRect(c.x - 3, c.y - 3, 6, 6);
          }
        }
      });
      // Anchor points.
      nodes.forEach((n, i) => {
        const p = L(n);
        ctx.beginPath();
        ctx.arc(p.x, p.y, i === selected ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = i === selected ? "#60a5fa" : "#fff";
        ctx.fill();
      });
    };

    const hitTest = (x: number, y: number): { index: number; part: "anchor" | "c1" | "c2" } | null => {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.type === "b") {
          for (const part of ["c1", "c2"] as const) {
            const c = n[part];
            if (c) {
              const l = toLocal(c.px, c.py);
              if (Math.hypot(l.x - x, l.y - y) <= HIT) return { index: i, part };
            }
          }
        }
      }
      for (let i = 0; i < nodes.length; i++) {
        const l = toLocal(nodes[i].px, nodes[i].py);
        if (Math.hypot(l.x - x, l.y - y) <= HIT) return { index: i, part: "anchor" };
      }
      return null;
    };

    ov.addEventListener("pointerdown", (e) => {
      const r = ov.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const hit = hitTest(x, y);
      if (hit) {
        drag = hit;
        if (hit.part === "anchor") selected = hit.index;
        ov.setPointerCapture(e.pointerId);
      } else {
        // Add a new vertex (the first one starts the shape).
        const pl = toPlay(x, y);
        nodes.push({ type: nodes.length ? "l" : "m", px: pl.px, py: pl.py });
        selected = nodes.length - 1;
      }
      redraw();
    });
    ov.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const r = ov.getBoundingClientRect();
      const pl = toPlay(e.clientX - r.left, e.clientY - r.top);
      const n = nodes[drag.index];
      if (drag.part === "anchor") {
        const dx = pl.px - n.px;
        const dy = pl.py - n.py;
        n.px = pl.px;
        n.py = pl.py;
        if (n.c1) (n.c1.px += dx), (n.c1.py += dy); // move the handles with the anchor
        if (n.c2) (n.c2.px += dx), (n.c2.py += dy);
      } else if (n[drag.part]) {
        n[drag.part]!.px = pl.px;
        n[drag.part]!.py = pl.py;
      }
      redraw();
    });
    const endDrag = (e: PointerEvent) => {
      if (drag) {
        drag = null;
        ov.releasePointerCapture(e.pointerId);
      }
    };
    ov.addEventListener("pointerup", endDrag);

    const bar = el("div", "se-posbar");
    const mkBtn = (label: string, primary: boolean, fn: () => void) => {
      const b = document.createElement("button");
      b.className = "se-obtn" + (primary ? " se-obtn-primary" : "");
      b.textContent = label;
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        fn();
      });
      return b;
    };
    // Toggle the selected vertex between a straight line and a bezier curve (spline
    // control points are left as-is).
    const toggleCurve = () => {
      if (selected <= 0 || !nodes[selected] || nodes[selected].type === "s") return;
      const n = nodes[selected];
      const prev = nodes[selected - 1];
      if (n.type === "b") {
        n.type = "l";
        delete n.c1;
        delete n.c2;
      } else {
        n.type = "b";
        n.c1 = { px: Math.round(prev.px + (n.px - prev.px) / 3), py: Math.round(prev.py + (n.py - prev.py) / 3) };
        n.c2 = { px: Math.round(prev.px + (2 * (n.px - prev.px)) / 3), py: Math.round(prev.py + (2 * (n.py - prev.py)) / 3) };
      }
      redraw();
    };
    bar.append(
      mkBtn(t("drawUndo"), false, () => {
        nodes.pop();
        selected = Math.min(selected, nodes.length - 1);
        redraw();
      }),
      mkBtn(t("drawCurve"), false, toggleCurve),
      mkBtn(t("drawClear"), false, () => {
        nodes.length = 0;
        selected = -1;
        redraw();
      }),
      mkBtn(t("apply"), true, () => this.applyDrawing(cue, nodes)),
      mkBtn(t("done"), false, () => this.exitDraw()),
    );
    ov.append(canvas, bar, el("div", "se-poshint", t("drawHint")));
    this.rightEl.appendChild(ov);
    this.drawOverlay = ov;
    redraw();
    document.addEventListener("keydown", this.onDrawKey, true);
    this.renderDetail();
  }

  // Parse the cue's existing \p drawing into editable vertices (PlayRes coords, with any
  // \pos/\move offset folded in). Supports m / l / b / s (and p, treated as extending s);
  // the c (close) command and anything else is skipped.
  private parseDrawing(cue: Cue): DrawNode[] {
    const body = cue.text.match(/\\p[1-9][^}]*\}([^{]*)/)?.[1];
    if (!body) return [];
    const pos = cue.text.match(/\\(?:pos|move)\((-?[\d.]+),(-?[\d.]+)/);
    const ox = pos ? parseFloat(pos[1]) : 0;
    const oy = pos ? parseFloat(pos[2]) : 0;
    const toks = body.trim().split(/\s+/).filter(Boolean);
    const nodes: DrawNode[] = [];
    let i = 0;
    let cmd = "";
    const num = () => parseFloat(toks[i++]);
    while (i < toks.length) {
      if (/^[a-zA-Z]+$/.test(toks[i])) {
        cmd = toks[i].toLowerCase();
        i++;
        continue;
      }
      if (cmd === "m" || cmd === "l") {
        const px = num() + ox;
        const py = num() + oy;
        if (Number.isNaN(px) || Number.isNaN(py)) break;
        nodes.push({ type: cmd === "m" ? "m" : "l", px, py });
        if (cmd === "m") cmd = "l";
      } else if (cmd === "b") {
        const c1 = { px: num() + ox, py: num() + oy };
        const c2 = { px: num() + ox, py: num() + oy };
        const px = num() + ox;
        const py = num() + oy;
        if (Number.isNaN(px) || Number.isNaN(py) || Number.isNaN(c1.px) || Number.isNaN(c2.px)) break;
        nodes.push({ type: "b", px, py, c1, c2 });
      } else if (cmd === "s" || cmd === "p") {
        const px = num() + ox;
        const py = num() + oy;
        if (Number.isNaN(px) || Number.isNaN(py)) break;
        nodes.push({ type: "s", px, py });
      } else i++;
    }
    return nodes.length >= 2 ? nodes : [];
  }

  private applyDrawing(cue: Cue, nodes: DrawNode[]): void {
    if (nodes.length < 2) return;
    // Absolute drawing: \an7\pos(0,0) puts the drawing origin at the screen origin, so the
    // PlayRes coords map directly onto the picture. Existing style tags are preserved.
    // A run of consecutive spline points shares one leading "s".
    const parts: string[] = [];
    let prev = "";
    nodes.forEach((n, i) => {
      if (i === 0) parts.push(`m ${n.px} ${n.py}`), (prev = "m");
      else if (n.type === "b" && n.c1 && n.c2) parts.push(`b ${n.c1.px} ${n.c1.py} ${n.c2.px} ${n.c2.py} ${n.px} ${n.py}`), (prev = "b");
      else if (n.type === "s") parts.push(prev === "s" ? `${n.px} ${n.py}` : `s ${n.px} ${n.py}`), (prev = "s");
      else parts.push(`l ${n.px} ${n.py}`), (prev = "l");
    });
    const cmds = parts.join(" ");
    const style = cue.text.replace(/\\p[1-9][^}]*\}[^{]*(?:\{\\p0\})?/g, "").match(/\\(1c|3c|4c|1a|3a|4a|bord|shad)[^\\}]*/g)?.join("") ?? "";
    cue.text = `{\\an7\\pos(0,0)${style}\\p1}${cmds}{\\p0}`;
    if (this.detailTextarea) this.detailTextarea.value = cue.text;
    this.refreshRow(cue.id);
    this.markDirty();
    this.exitDraw();
  }

  private onDrawKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this.drawOverlay) {
      e.preventDefault();
      this.exitDraw();
    }
  };

  private exitDraw(): void {
    document.removeEventListener("keydown", this.onDrawKey, true);
    this.drawOverlay?.remove();
    this.drawOverlay = null;
    this.renderDetail();
  }

  // --- fade ----------------------------------------------------------------

  // Fade popover. Simple in/out writes \fad(in,out); ticking "Advanced" exposes the
  // 7-argument \fade(a1,a2,a3,t1,t2,t3,t4) form and writes that instead.
  private openFade(cue: Cue, ta: HTMLTextAreaElement): void {
    this.detailEl.querySelector(".se-fadepop")?.remove();
    const simple = cue.text.match(/\\fad\((\d+),(\d+)\)/);
    const adv = cue.text.match(/\\fade\(([^)]*)\)/);
    const av = adv ? adv[1].split(",").map((s) => s.trim()) : [];
    const dur = Math.max(0, cue.endMs - cue.startMs);
    const pop = el("div", "se-fadepop se-xform");
    const field = (parent: HTMLElement, label: string, val: string): HTMLInputElement => {
      const wrap = el("label", "se-field", label);
      const input = document.createElement("input");
      input.type = "number";
      input.value = val;
      wrap.appendChild(input);
      parent.appendChild(wrap);
      return input;
    };
    const group = (title: string, tip = ""): HTMLElement => {
      const g = el("div", "se-xgroup");
      g.appendChild(el("span", "se-xglabel", title));
      if (tip) g.title = tip;
      pop.appendChild(g);
      return g;
    };

    const simpleGrp = group(t("fade"), t("tipFadeSimple"));
    const fin = field(simpleGrp, t("fadeIn"), simple?.[1] ?? "200");
    const fout = field(simpleGrp, t("fadeOut"), simple?.[2] ?? "200");

    const advToggle = el("label", "se-field se-checkfield", t("fadeAdvanced"));
    const advCb = document.createElement("input");
    advCb.type = "checkbox";
    advCb.checked = !!adv;
    advToggle.appendChild(advCb);
    pop.appendChild(advToggle);

    const advGrp = group(t("fadeAdvanced"));
    const a1 = field(advGrp, "α1", av[0] ?? "255");
    const a2 = field(advGrp, "α2", av[1] ?? "0");
    const a3 = field(advGrp, "α3", av[2] ?? "255");
    for (const a of [a1, a2, a3]) a.title = t("tipFadeAlpha");
    const t1 = field(advGrp, "t1", av[3] ?? "0");
    const t2 = field(advGrp, "t2", av[4] ?? String(Math.min(300, dur)));
    const t3 = field(advGrp, "t3", av[5] ?? String(Math.max(0, dur - 300)));
    const t4 = field(advGrp, "t4", av[6] ?? String(dur));
    for (const tf of [t1, t2, t3, t4]) tf.title = t("tipFadeTimes");

    const sync = (): void => {
      advGrp.style.display = advCb.checked ? "" : "none";
      simpleGrp.style.display = advCb.checked ? "none" : "";
    };
    advCb.addEventListener("change", sync);
    sync();

    const apply = document.createElement("button");
    apply.className = "se-btn";
    apply.textContent = t("apply");
    apply.addEventListener("click", () => {
      const stripped = cue.text.replace(/\\fade\([^)]*\)/g, "").replace(/\\fad\([^)]*\)/g, "").replace(/\{\}/g, "");
      let tag: string;
      if (advCb.checked) {
        const v = [a1, a2, a3, t1, t2, t3, t4].map((i) => parseInt(i.value, 10) || 0);
        tag = `{\\fade(${v.join(",")})}`;
      } else {
        tag = `{\\fad(${parseInt(fin.value, 10) || 0},${parseInt(fout.value, 10) || 0})}`;
      }
      ta.value = tag + stripped;
      this.updateCue(cue.id, { text: ta.value }, true);
      pop.remove();
    });
    pop.appendChild(apply);
    this.detailEl.appendChild(pop);
    fin.focus();
  }

  // Transform popover, grouped: Rotate (\frx/\fry/\frz) + origin (\org), Scale
  // (\fscx/\fscy), Shear (\fax/\fay), plus spacing/blur/edge-blur. Animate wraps the
  // animatable tags in \t (\org is not animatable, so it stays outside).
  private openTransform(cue: Cue, ta: HTMLTextAreaElement): void {
    this.detailEl.querySelector(".se-fadepop")?.remove();
    const get = (re: RegExp, def: string): string => cue.text.match(re)?.[1] ?? def;
    const pop = el("div", "se-fadepop se-xform");
    const field = (parent: HTMLElement, label: string, val: string): HTMLInputElement => {
      const wrap = el("label", "se-field", label);
      const input = document.createElement("input");
      input.type = "number";
      input.value = val;
      wrap.appendChild(input);
      parent.appendChild(wrap);
      return input;
    };
    const group = (title: string, tip = ""): HTMLElement => {
      const g = el("div", "se-xgroup");
      g.appendChild(el("span", "se-xglabel", title));
      if (tip) g.title = tip;
      pop.appendChild(g);
      return g;
    };

    const rot = group(t("rotate"), t("tipRotate"));
    const frx = field(rot, "X", get(/\\frx(-?[\d.]+)/, "0"));
    const fry = field(rot, "Y", get(/\\fry(-?[\d.]+)/, "0"));
    const frz = field(rot, "Z", get(/\\frz(-?[\d.]+)/, "0"));
    const org = cue.text.match(/\\org\((-?[\d.]+),(-?[\d.]+)\)/);
    const originGrp = group(t("origin"), t("tipOrigin"));
    const orgX = field(originGrp, "X", org?.[1] ?? "");
    const orgY = field(originGrp, "Y", org?.[2] ?? "");
    const scale = group(t("scale"), t("tipScale"));
    const fscx = field(scale, "X", get(/\\fscx([\d.]+)/, "100"));
    const fscy = field(scale, "Y", get(/\\fscy([\d.]+)/, "100"));
    const shear = group(t("shear"), t("tipShear"));
    const fax = field(shear, "X", get(/\\fax(-?[\d.]+)/, "0"));
    const fay = field(shear, "Y", get(/\\fay(-?[\d.]+)/, "0"));
    const misc = group("");
    const fsp = field(misc, t("styleSpacing"), get(/\\fsp(-?[\d.]+)/, "0"));
    fsp.title = t("tipSpacing");
    const blur = field(misc, t("blur"), get(/\\blur([\d.]+)/, "0"));
    blur.title = t("tipBlur");
    const be = field(misc, t("edgeBlur"), get(/\\be([\d.]+)/, "0"));
    be.title = t("tipEdgeBlur");
    // Per-axis border/shadow. Blank = inherit \bord/\shad; a number (incl. 0) overrides.
    const axes = group(t("borderShadowAxes"), t("tipAxes"));
    const xbord = field(axes, `${t("borderWidth")} X`, cue.text.match(/\\xbord([\d.]+)/)?.[1] ?? "");
    const ybord = field(axes, `${t("borderWidth")} Y`, cue.text.match(/\\ybord([\d.]+)/)?.[1] ?? "");
    const xshad = field(axes, `${t("shadowWidth")} X`, cue.text.match(/\\xshad(-?[\d.]+)/)?.[1] ?? "");
    const yshad = field(axes, `${t("shadowWidth")} Y`, cue.text.match(/\\yshad(-?[\d.]+)/)?.[1] ?? "");

    // Animate: wrap the transform in \t so it eases from the style default to these values.
    const animWrap = el("label", "se-field se-checkfield", t("animate"));
    animWrap.title = t("tipAnimate");
    const anim = document.createElement("input");
    anim.type = "checkbox";
    anim.checked = /\\t\(/.test(cue.text);
    animWrap.appendChild(anim);
    pop.appendChild(animWrap);

    const apply = document.createElement("button");
    apply.className = "se-btn";
    apply.textContent = t("apply");
    apply.addEventListener("click", () => {
      const stripped = cue.text
        .replace(/\\t\([^)]*\)/g, "")
        .replace(/\\org\([^)]*\)/g, "")
        .replace(/\\(frx|fry|frz|fscx|fscy|fsp|be|blur|fax|fay|xbord|ybord|xshad|yshad)-?[\d.]+/g, "")
        .replace(/\{\}/g, "");
      const tags: string[] = [];
      const add = (tag: string, v: string, def: number) => {
        if (v !== "" && parseFloat(v) !== def) tags.push(`\\${tag}${v}`);
      };
      const addRaw = (tag: string, v: string) => {
        if (v !== "") tags.push(`\\${tag}${v}`); // no inherit-default, any value overrides
      };
      add("frx", frx.value, 0);
      add("fry", fry.value, 0);
      add("frz", frz.value, 0);
      add("fscx", fscx.value, 100);
      add("fscy", fscy.value, 100);
      add("fax", fax.value, 0);
      add("fay", fay.value, 0);
      add("fsp", fsp.value, 0);
      add("blur", blur.value, 0);
      add("be", be.value, 0);
      addRaw("xbord", xbord.value);
      addRaw("ybord", ybord.value);
      addRaw("xshad", xshad.value);
      addRaw("yshad", yshad.value);
      const anims = tags.length ? (anim.checked ? `\\t(${tags.join("")})` : tags.join("")) : "";
      const origin = orgX.value !== "" && orgY.value !== "" ? `\\org(${orgX.value},${orgY.value})` : "";
      const body = origin + anims;
      ta.value = (body ? `{${body}}` : "") + stripped;
      this.updateCue(cue.id, { text: ta.value }, true);
      pop.remove();
    });
    pop.appendChild(apply);
    this.detailEl.appendChild(pop);
    frz.focus();
  }

  private timeField(label: string, value: string, onCommit: (v: string) => void): HTMLElement {
    const wrap = el("label", "se-field", label);
    const input = document.createElement("input");
    input.value = value;
    const commit = () => onCommit(input.value.trim());
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
    wrap.appendChild(input);
    return wrap;
  }

  // ASS style picker for the selected cue: the file's style names, plus the cue's own
  // style if the file didn't declare it. Writing sets the cue's Style Event field; the
  // adjacent pencil opens the editor for the selected style.
  private styleField(cue: Cue): HTMLElement {
    const wrap = el("label", "se-field se-stylefield", t("style"));
    const row = el("div", "se-stylerow");
    const select = document.createElement("select");
    const current = cue.assFields?.Style ?? "Default";
    const declared = styleNames(this.doc);
    const names = declared.length ? [...declared] : ["Default"];
    if (!names.includes(current)) names.unshift(current);
    for (const name of names) {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      select.appendChild(o);
    }
    select.value = current;
    select.addEventListener("change", () => {
      (cue.assFields ??= {}).Style = select.value;
      this.refreshRow(cue.id);
      this.markDirty();
    });
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "se-btn se-iconbtn se-styleedit";
    edit.innerHTML = ICON.styles;
    edit.title = t("editStyle");
    edit.setAttribute("aria-label", t("editStyle"));
    edit.addEventListener("click", () => this.editStyle(select.value));
    row.append(select, edit);
    wrap.appendChild(row);
    return wrap;
  }

  // The remaining ASS Event fields for the selected cue, grouped into a fields row
  // (disable / actor / layer / effect) and a margins row.
  private assExtrasRow(cue: Cue): HTMLElement {
    const box = el("div", "se-assbox");
    const row = el("div", "se-times se-assextras");

    const cwrap = el("label", "se-field se-checkfield", t("disabled"));
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = cue.assKind === "Comment";
    cb.addEventListener("change", () => {
      cue.assKind = cb.checked ? "Comment" : "Dialogue";
      this.refreshRow(cue.id);
      this.timeline?.render();
      this.markDirty();
    });
    cwrap.appendChild(cb);
    row.append(cwrap, this.assField(cue, "Name", t("actor"), "text", "se-actorfield", undefined, t("tipActor")), this.assField(cue, "Layer", t("layer"), "number", "se-numfield", undefined, t("tipLayer")), this.assEffectField(cue));
    box.appendChild(row);

    // Margins group: Left / Right, and Vertical only when the line is top/bottom aligned.
    const margins = el("div", "se-times se-margins");
    margins.appendChild(el("span", "se-grouplabel", t("marginsLabel")));
    margins.append(this.assField(cue, "MarginL", t("marginL"), "number", "se-numfield"), this.assField(cue, "MarginR", t("marginR"), "number", "se-numfield"));
    if (![4, 5, 6].includes(this.effectiveAlign(cue))) margins.appendChild(this.assField(cue, "MarginV", t("marginV"), "number", "se-numfield"));
    box.appendChild(margins);
    return box;
  }

  // The cue's alignment: an inline \an override, else the assigned style's, else 2.
  private effectiveAlign(cue: Cue): number {
    const an = cue.text.match(/\\an([1-9])/);
    if (an) return parseInt(an[1], 10);
    const style = this.doc.styles?.find((s) => s.name === (cue.assFields?.Style ?? "Default"));
    return parseInt(style?.fields.Alignment ?? "2", 10) || 2;
  }

  // Effect: a type dropdown (None / Banner / Scroll up / Scroll down; Karaoke only if the
  // cue already uses it) plus parameter fields for the chosen effect.
  private assEffectField(cue: Cue): HTMLElement {
    const PREFIX: Record<string, string> = { banner: "Banner", scrollup: "Scroll up", scrolldown: "Scroll down", karaoke: "Karaoke" };
    type ParamSpec = { label: string; def: string; options?: [string, string][] };
    const SPECS: Record<string, ParamSpec[]> = {
      banner: [
        { label: t("effDelay"), def: "40" },
        { label: t("direction"), def: "0", options: [["0", t("rightToLeft")], ["1", t("leftToRight")]] },
        { label: t("effFade"), def: "0" },
      ],
      scrollup: [{ label: t("effY1"), def: "0" }, { label: t("effY2"), def: "0" }, { label: t("effDelay"), def: "40" }, { label: t("effFade"), def: "0" }],
      scrolldown: [{ label: t("effY1"), def: "0" }, { label: t("effY2"), def: "0" }, { label: t("effDelay"), def: "40" }, { label: t("effFade"), def: "0" }],
    };
    const cur = cue.assFields?.Effect ?? "";
    const type = /^banner/i.test(cur) ? "banner" : /^scroll up/i.test(cur) ? "scrollup" : /^scroll down/i.test(cur) ? "scrolldown" : /^karaoke/i.test(cur) ? "karaoke" : "none";

    const group = el("div", "se-field se-effectgroup");
    group.append(el("span", "", t("effect")));
    const rowEl = el("div", "se-effectrow");
    const sel = document.createElement("select");
    sel.title = t("tipEffect");
    const opts: [string, string][] = [["none", t("effectNone")], ["banner", t("banner")], ["scrollup", t("scrollUp")], ["scrolldown", t("scrollDown")]];
    if (type === "karaoke") opts.push(["karaoke", t("karaoke")]);
    for (const [v, l] of opts) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = l;
      sel.appendChild(o);
    }
    sel.value = type;
    const params = el("div", "se-effectparams");
    rowEl.append(sel, params);
    group.appendChild(rowEl);

    const setEffect = (val: string) => {
      (cue.assFields ??= {}).Effect = val;
      this.refreshRow(cue.id);
      this.markDirty();
    };
    const build = (t2: string, parts: string[], commit: boolean): void => {
      params.textContent = "";
      if (t2 === "none") {
        if (commit) setEffect("");
        return;
      }
      if (t2 === "karaoke") {
        if (commit) setEffect("Karaoke");
        return;
      }
      const spec = SPECS[t2];
      const inputs = spec.map((s, i) => {
        const wrap = el("label", "se-field " + (s.options ? "se-selfield" : "se-numfield"), s.label);
        let input: HTMLInputElement | HTMLSelectElement;
        if (s.options) {
          const sel2 = document.createElement("select");
          for (const [v, l] of s.options) {
            const o = document.createElement("option");
            o.value = v;
            o.textContent = l;
            sel2.appendChild(o);
          }
          sel2.value = parts[i] ?? s.def;
          input = sel2;
        } else {
          const n = document.createElement("input");
          n.type = "number";
          n.value = parts[i] ?? s.def;
          input = n;
        }
        wrap.appendChild(input);
        params.appendChild(wrap);
        return input;
      });
      const rebuild = () => setEffect(`${PREFIX[t2]};${inputs.map((x) => x.value || "0").join(";")}`);
      inputs.forEach((x) => x.addEventListener("change", rebuild));
      if (commit) rebuild();
    };
    sel.addEventListener("change", () => build(sel.value, [], true));
    build(type, cur.split(";").slice(1), false);
    return group;
  }

  private assField(cue: Cue, key: string, label: string, type: "text" | "number", cls: string, datalist?: string[], tip?: string): HTMLElement {
    const wrap = el("label", `se-field ${cls}`, label);
    if (tip) wrap.title = tip;
    const input = document.createElement("input");
    input.type = type;
    input.value = cue.assFields?.[key] ?? (type === "number" ? "0" : "");
    if (datalist) {
      const id = `se-dl-${key}`;
      input.setAttribute("list", id);
      const dl = document.createElement("datalist");
      dl.id = id;
      for (const v of datalist) {
        const o = document.createElement("option");
        o.value = v;
        dl.appendChild(o);
      }
      wrap.appendChild(dl);
      input.title = t("effectHint");
    }
    const commit = () => {
      (cue.assFields ??= {})[key] = input.value;
      this.refreshRow(cue.id);
      this.markDirty();
    };
    input.addEventListener("change", commit);
    wrap.appendChild(input);
    return wrap;
  }

  private addStyle(): void {
    this.doc.styles ??= [];
    const style = makeDefaultStyle(uniqueStyleName(this.doc, "New style"));
    this.doc.styles.push(style);
    this.markDirty();
    this.renderDetail();
    this.openStyleEditor(style);
  }

  private editStyle(name: string): void {
    this.doc.styles ??= [];
    let style = this.doc.styles.find((s) => s.name === name);
    if (!style) {
      style = makeDefaultStyle(name);
      this.doc.styles.push(style);
    }
    this.openStyleEditor(style);
  }

  private openStyleEditor(style: AssStyle): void {
    openStyleEditor(
      {
        getDoc: () => this.doc,
        onChange: () => {
          this.renderDetail(); // refresh the style dropdown options + selection
          this.markDirty();
        },
        onRenameStyle: (from, to) => {
          for (const c of this.doc.cues) if (c.assFields?.Style === from) c.assFields.Style = to;
        },
      },
      style,
    );
  }

  // --- editing operations --------------------------------------------------

  private updateCue(id: string, patch: Partial<Cue>, fromText = false): void {
    const cue = this.doc.cues.find((c) => c.id === id);
    if (!cue) return;
    Object.assign(cue, patch);
    this.refreshRow(id);
    this.timeline?.render();
    // Editing the text area should not re-render the detail (it would drop the caret).
    if (!fromText) this.renderDetail();
    this.markDirty();
  }

  // Auto-transcription: lazily load the transcribe UI (which pulls in transformers.js) and
  // open the dialog, wired to the loaded media and cue insertion.
  // Lazily load the transcribe/translate dialog module. A dynamic import can fail transiently
  // (a dev-server dependency re-optimize race, a network hiccup) and would otherwise leave the
  // toolbar button doing nothing with no feedback; surface it as a toast instead of silence.
  private loadTranscribeUi(): Promise<typeof import("./transcribe/ui")> {
    return import("./transcribe/ui").catch((e) => {
      this.toast(t("dialogLoadFailed"));
      throw e;
    });
  }

  private openTranscribe(): void {
    void this.loadTranscribeUi()
      .then(({ openTranscribeDialog }) => {
        openTranscribeDialog({
          mediaFile: () => this.mediaFile,
          hasCues: () => this.doc.cues.length > 0,
          onResult: (cues, mode) => this.insertTranscribedCues(cues, mode),
        });
      })
      .catch(() => {});
  }

  private activeTrack(): Track {
    return this.tracks.find((t) => t.id === this.activeTrackId) ?? this.tracks[0];
  }

  // Mux all subtitle tracks back into the loaded media (stream-copying video/audio) and save
  // it. When the File System Access API is available the output streams straight to the
  // chosen file (so multi-GB saves never buffer in RAM); otherwise it downloads a blob.
  private async saveIntoVideo(): Promise<void> {
    if (!this.mediaFile) {
      this.toast(t("saveVideoNeedsMedia"));
      return;
    }
    // Save back into the source's container (detected at load). MKV keeps ASS tracks styled
    // (S_TEXT/ASS); MP4 and everything else can only hold plain-text WebVTT.
    const container = this.mediaContainer;

    // Ask for the destination file FIRST, before serializing the tracks: serializing thousands
    // of cues across tracks can take long enough to expire the click's transient user
    // activation, after which showSaveFilePicker throws and no dialog appears.
    const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
    let handle: FileSystemFileHandle | null = null;
    if (picker) {
      try {
        handle = await picker.call(window, { suggestedName: `subtitled.${container}`, types: [{ description: container.toUpperCase(), accept: { [container === "mkv" ? "video/x-matroska" : "video/mp4"]: [`.${container}`] } }] });
      } catch {
        return; // user cancelled the save dialog
      }
    }

    const subs = this.tracks.map((tr) =>
      container === "mkv" && tr.doc.format === "ass"
        ? { name: tr.label, language: tr.language, kind: "ass" as const, content: serializeSubtitles(tr.doc) }
        : { name: tr.label, language: tr.language, kind: "vtt" as const, content: serializeSubtitles(convertDoc(tr.doc, "vtt")) },
    );

    this.countEl.textContent = t("savingVideo");
    let lastTick = 0;
    const onBytes = (written: number): void => {
      const now = Date.now();
      if (now - lastTick < 250) return; // throttle DOM updates
      lastTick = now;
      this.countEl.textContent = `${t("savingVideo")} ${(written / 1e6).toFixed(1)} MB`;
    };
    // Stream from the original File (disk-backed); BlobSource reads it on demand, so a multi-GB
    // save never buffers the source in RAM.
    const media = this.mediaFile;
    try {
      const { muxIntoContainer, muxToFile } = await import("./mux");
      if (handle) {
        const writable = await (handle as unknown as { createWritable(): Promise<import("./mux").FileWritable> }).createWritable();
        await muxToFile(media, subs, container, writable, onBytes);
      } else {
        const out = await muxIntoContainer(media, subs, container);
        const mime = container === "mkv" ? "video/x-matroska" : "video/mp4";
        const url = URL.createObjectURL(new Blob([out as BlobPart], { type: mime }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `subtitled.${container}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      this.countEl.textContent = t("cueCount", { n: this.doc.cues.length });
      this.toast(t("saveVideoDone"));
    } catch (e) {
      this.countEl.textContent = t("cueCount", { n: this.doc.cues.length });
      this.toast(`${t("saveVideoError")}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Translate the active track: lazily open the translate dialog over its cue texts, then
  // add the result as a new track sharing the source timing/styles.
  private openTranslate(): void {
    const source = this.activeTrack();
    // Build a de-duplicated translation plan: split each cue into tag/run parts (only runs are
    // translated, tags and breaks are preserved), skip drawing cues, and translate each unique
    // run string once, fanning the result out to every cue that shares it.
    const plan = buildTranslationPlan(source.doc.cues.map((c) => c.text));
    void this.loadTranscribeUi()
      .then(({ openTranslateDialog }) => {
        openTranslateDialog({
          cueTexts: () => plan.uniqueTexts,
          sourceLanguage: () => source.language,
          onStart: (opts, targetCode, targetLabel) => this.startTranslateJob(source, plan, opts, targetCode, targetLabel),
        });
      })
      .catch(() => {});
  }

  // Create the target track immediately (cloning the source timing/styles, cues still holding
  // the source text) and run the translation as a live background job that fills the cues as
  // batches arrive. The user can keep editing meanwhile.
  private startTranslateJob(
    source: Track,
    plan: TranslationPlan,
    opts: { model: string; srcLang: string; tgtLang: string },
    targetCode: string,
    targetLabel: string,
  ): void {
    const doc = structuredClone(source.doc) as SubtitleDoc;
    doc.cues = doc.cues.map((c, ci) => ({ ...c, id: newCueId(), text: rebuildCueText(plan, ci) ?? c.text }));
    const track: Track = {
      id: newTrackId(),
      label: targetLabel,
      language: targetCode,
      doc,
      job: { run: null, state: "running", stage: "download", ratio: 0, plan, opts, translated: new Array(plan.uniqueTexts.length).fill(false), done: 0, total: plan.uniqueTexts.length },
    };
    this.tracks.push(track);
    this.switchTrack(track.id);
    this.markDirty();
    // First pass covers every unique text.
    this.runTranslationPass(track, plan.uniqueTexts.map((_t, u) => u));
  }

  // Spawn a worker over the given unique-text indices and stream results back. Used both for the
  // initial pass (all indices) and for a retry (only the not-yet-translated indices), so an
  // interrupted job can be resumed without redoing finished lines.
  private runTranslationPass(track: Track, uniqueIndices: number[]): void {
    const job = track.job;
    if (!job) return;
    if (!uniqueIndices.length) {
      this.finishTranslateJob(track, false);
      return;
    }
    job.state = "running";
    job.errorMsg = undefined;
    job.stage = "download";
    this.renderJobStrip();
    this.renderTrackBar();
    const texts = uniqueIndices.map((u) => job.plan.mtSource[u]);
    job.run = runTranslate(texts, job.opts, {
      onProgress: (p) => {
        job.stage = p.stage === "download" ? "download" : "translate";
        // Translate progress is overall (done/total) so a resume continues the bar instead of
        // restarting it; the worker's own ratio only tracks this pass.
        job.ratio = p.stage === "download" ? p.ratio : job.total ? job.done / job.total : 0;
        this.renderJobStrip();
        this.renderTrackBar();
      },
      onPartial: (start, batch) => this.applyTranslatedBatch(track, uniqueIndices, start, batch),
      onDevice: (device) => {
        job.device = device;
        this.renderJobStrip();
      },
    });
    job.run.done
      .then((res) => this.finishTranslateJob(track, res.stopped))
      .catch((e) => this.pauseTranslateOnError(track, e));
  }

  // Splice a translated batch into the track: map each result back to its unique text via this
  // pass's index list, fan it out to every cue/part that shares it, then rebuild those cues.
  // Re-renders the list/preview only when this track is showing.
  private applyTranslatedBatch(track: Track, uniqueIndices: number[], start: number, batch: string[]): void {
    const job = track.job;
    if (!job) return;
    const touched = new Set<number>();
    batch.forEach((tx, k) => {
      const u = uniqueIndices[start + k];
      if (u === undefined || job.translated[u]) return;
      job.translated[u] = true;
      job.done += 1;
      if (tx == null) return;
      for (const ci of applyUniqueTranslation(job.plan, u, tx)) touched.add(ci);
    });
    touched.forEach((ci) => {
      const text = rebuildCueText(job.plan, ci);
      if (text != null) track.doc.cues[ci].text = text;
    });
    this.markDirty();
    if (track.id === this.activeTrackId) {
      this.renderWindow();
      this.schedulePreviewPush();
    }
    this.renderJobStrip();
    this.renderTrackBar();
  }

  // An error (e.g. a WebGPU device loss the worker couldn't recover from) leaves the job in
  // place, paused in an "error" state, so the already-translated lines are kept and the user can
  // retry to finish the rest instead of being stuck with a half-translated track.
  private pauseTranslateOnError(track: Track, e: unknown): void {
    const job = track.job;
    if (!job) return;
    job.run = null;
    if (job.done >= job.total) {
      this.finishTranslateJob(track, false); // everything landed despite the error
      return;
    }
    job.state = "error";
    job.stage = "translate";
    job.ratio = job.total ? job.done / job.total : 0;
    job.errorMsg = e instanceof Error ? e.message : String(e);
    this.toast(`${t("translateError")}: ${job.errorMsg}`);
    this.renderJobStrip();
    this.renderTrackBar();
  }

  private retryTranslateJob(track: Track): void {
    const job = track.job;
    if (!job) return;
    const remaining: number[] = [];
    for (let u = 0; u < job.total; u += 1) if (!job.translated[u]) remaining.push(u);
    this.runTranslationPass(track, remaining);
  }

  // Coalesce the (relatively costly) live subtitle re-push to the preview during a job.
  private schedulePreviewPush(): void {
    if (this.previewPushTimer != null) return;
    this.previewPushTimer = window.setTimeout(() => {
      this.previewPushTimer = null;
      this.pushSubtitles();
    }, 400);
  }

  private finishTranslateJob(track: Track, stopped: boolean): void {
    const job = track.job;
    if (job) {
      // Final pass in case a batch straddled the last render.
      job.plan.parsed.forEach((_parts, ci) => {
        const text = rebuildCueText(job.plan, ci);
        if (text != null) track.doc.cues[ci].text = text;
      });
    }
    track.job = undefined;
    this.renderTrackBar();
    this.renderJobStrip();
    if (track.id === this.activeTrackId) {
      this.renderWindow();
      this.pushSubtitles();
    }
    this.toast(stopped ? t("translateStopped") : t("translateDone"));
    this.markDirty();
  }

  private toggleTranslatePause(track: Track): void {
    const job = track.job;
    if (!job || !job.run) return; // no live worker (errored) -> use retry instead
    if (job.state === "paused") {
      job.state = "running";
      job.run.resume();
    } else {
      job.state = "paused";
      job.run.pause();
    }
    this.renderJobStrip();
  }

  private stopTranslateJob(track: Track): void {
    if (!track.job) return;
    track.job.run?.cancel(); // batches already applied stay; the rest keep the source text
    this.finishTranslateJob(track, true);
  }

  // The strip under the track bar: progress + pause/resume/stop for the active track's job.
  private renderJobStrip(): void {
    if (!this.jobStrip) return;
    this.jobStrip.textContent = "";
    const track = this.activeTrack();
    const job = track?.job;
    if (!job) {
      this.jobStrip.classList.remove("on");
      return;
    }
    this.jobStrip.classList.add("on");
    this.jobStrip.classList.toggle("err", job.state === "error");
    const pct = Math.round(job.ratio * 100);
    const dev = job.device ? ` · ${job.device === "webgpu" ? t("asrUsingGpu") : t("asrUsingCpu")}` : "";
    let text: string;
    if (job.state === "error") text = `⚠ ${t("translateInterrupted")} ${job.done}/${job.total}`;
    else if (job.stage === "download") text = `${t("asrDownloading")} ${pct}%`;
    else text = `${t("translating")} ${job.done}/${job.total} (${pct}%)${dev}`;
    const lab = el("span", "se-job-label", text);
    const bar = el("div", "se-job-bar");
    const fill = el("div", "se-job-fill");
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    this.jobStrip.append(lab, bar);
    if (job.state === "error") {
      const retryBtn = el("button", "se-job-btn", "↻");
      retryBtn.title = t("jobRetry");
      retryBtn.addEventListener("click", () => this.retryTranslateJob(track));
      this.jobStrip.appendChild(retryBtn);
    } else {
      const pauseBtn = el("button", "se-job-btn", job.state === "paused" ? "▶" : "⏸");
      pauseBtn.title = job.state === "paused" ? t("jobResume") : t("jobPause");
      pauseBtn.addEventListener("click", () => this.toggleTranslatePause(track));
      this.jobStrip.appendChild(pauseBtn);
    }
    const stopBtn = el("button", "se-job-btn", "⏹");
    stopBtn.title = t("jobStop");
    stopBtn.addEventListener("click", () => this.stopTranslateJob(track));
    this.jobStrip.appendChild(stopBtn);
  }

  private insertTranscribedCues(segs: { startMs: number; endMs: number; text: string }[], mode: "append" | "replace"): void {
    if (!segs.length) return;
    const style = this.doc.format === "ass" ? (styleNames(this.doc)[0] ?? "Default") : undefined;
    const made = segs.map((s) => {
      const cue = blankCue(s.startMs, s.endMs, s.text);
      if (style) (cue.assFields ??= {}).Style = style;
      return cue;
    });
    this.doc.cues = mode === "replace" ? made : sortCues([...this.doc.cues, ...made]);
    this.rows.clear();
    this.innerEl.textContent = "";
    this.scrollEl.scrollTop = 0;
    this.selectedId = null;
    this.renderList();
    this.select(this.doc.cues[0].id);
    this.markDirty();
  }

  private addCue(): void {
    const sel = this.selectedCue();
    const startMs = sel ? sel.endMs : (this.video?.currentTime ?? 0) * 1000;
    const cue = blankCue(Math.round(startMs));
    const insertAt = sel ? this.doc.cues.indexOf(sel) + 1 : this.doc.cues.length;
    this.doc.cues.splice(insertAt, 0, cue);
    this.renderList();
    this.select(cue.id);
    this.markDirty();
  }

  private removeCue(): void {
    const cue = this.selectedCue();
    if (!cue) return;
    const i = this.doc.cues.indexOf(cue);
    this.doc.cues.splice(i, 1);
    this.rows.get(cue.id)?.remove();
    this.rows.delete(cue.id);
    this.selectedId = null;
    this.renderList();
    const next = this.doc.cues[Math.min(i, this.doc.cues.length - 1)];
    if (next) this.select(next.id);
    else this.renderDetail();
    this.markDirty();
  }

  // Merge the selected cue with the one after it: join their text with a space and span the
  // combined time, then drop the second cue. Styles/fields of the first cue are kept.
  private mergeCue(): void {
    const cue = this.selectedCue();
    if (!cue) return;
    const i = this.doc.cues.indexOf(cue);
    const next = this.doc.cues[i + 1];
    if (!next) {
      this.toast(t("mergeNoNext"));
      return;
    }
    cue.text = `${cue.text.trimEnd()} ${next.text.trimStart()}`.trim();
    cue.endMs = Math.max(cue.endMs, next.endMs);
    this.doc.cues.splice(i + 1, 1);
    this.rows.get(next.id)?.remove();
    this.rows.delete(next.id);
    this.renderList();
    this.select(cue.id);
    this.markDirty();
  }

  // Split the selected cue at the caret (or the midpoint), dividing the duration in proportion
  // to each part's text length. ASS style/fields carry to the new second cue.
  private splitCue(): void {
    const cue = this.selectedCue();
    if (!cue) return;
    const text = cue.text;
    const ta = this.detailTextarea;
    let at = ta && document.activeElement === ta ? ta.selectionStart : Math.floor(text.length / 2);
    if (at <= 0 || at >= text.length) at = Math.floor(text.length / 2);
    if (at <= 0) {
      this.toast(t("splitTooShort"));
      return;
    }
    const first = text.slice(0, at).trimEnd();
    const rest = text.slice(at).trimStart();
    const total = cue.endMs - cue.startMs;
    const frac = first.length / Math.max(1, first.length + rest.length);
    const mid = cue.startMs + Math.max(1, Math.min(total - 1, Math.round(total * frac)));
    const second = blankCue(mid, cue.endMs, rest);
    if (this.doc.format === "ass") {
      second.assKind = cue.assKind;
      if (cue.assFields) second.assFields = { ...cue.assFields };
    }
    cue.text = first;
    cue.endMs = mid;
    const i = this.doc.cues.indexOf(cue);
    this.doc.cues.splice(i + 1, 0, second);
    this.renderList();
    this.select(cue.id);
    this.markDirty();
  }

  // --- find / replace ------------------------------------------------------

  private toggleFind(): void {
    if (this.findBar) {
      this.closeFind();
      return;
    }
    const bar = el("div", "se-findbar") as HTMLDivElement;
    const find = document.createElement("input");
    find.type = "text";
    find.placeholder = t("find");
    find.className = "se-findinput";
    find.setAttribute("aria-label", t("find"));
    this.findInput = find;
    const count = el("span", "se-findcount") as HTMLSpanElement;
    this.findCountEl = count;
    const prev = this.button("‹", () => this.findStep(-1));
    const next = this.button("›", () => this.findStep(1));
    prev.className = next.className = "se-obtn";
    prev.title = t("findPrev");
    next.title = t("findNext");
    const repl = document.createElement("input");
    repl.type = "text";
    repl.placeholder = t("replace");
    repl.className = "se-findinput";
    repl.setAttribute("aria-label", t("replace"));
    this.findReplaceInput = repl;
    const replAll = this.button(t("replaceAll"), () => this.replaceAll());
    replAll.className = "se-obtn";
    const close = this.button("✕", () => this.closeFind());
    close.className = "se-obtn";
    close.title = t("close");
    close.setAttribute("aria-label", t("close"));
    find.addEventListener("input", () => this.runFind(find.value));
    find.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.findStep(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.closeFind();
      }
    });
    repl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.closeFind();
      }
    });
    bar.append(find, count, prev, next, repl, replAll, close);
    this.findBar = bar;
    (this.jobStrip ?? this.trackBar).after(bar);
    find.focus();
    this.runFind("");
  }

  private closeFind(): void {
    this.findBar?.remove();
    this.findBar = null;
    this.findInput = this.findReplaceInput = this.findCountEl = null;
    this.findMatches = [];
    this.findPos = -1;
  }

  private runFind(query: string): void {
    const q = query.toLowerCase();
    this.findMatches = q ? this.doc.cues.filter((c) => c.text.toLowerCase().includes(q)).map((c) => c.id) : [];
    this.findPos = this.findMatches.length ? 0 : -1;
    this.updateFindCount();
    if (this.findPos >= 0) this.select(this.findMatches[0]);
  }

  private findStep(dir: number): void {
    if (!this.findMatches.length) return;
    this.findPos = (this.findPos + dir + this.findMatches.length) % this.findMatches.length;
    this.updateFindCount();
    this.select(this.findMatches[this.findPos]);
  }

  private updateFindCount(): void {
    if (!this.findCountEl) return;
    this.findCountEl.textContent = this.findMatches.length
      ? t("findCount", { i: String(this.findPos + 1), n: String(this.findMatches.length) })
      : this.findInput?.value
        ? t("noMatches")
        : "";
  }

  private replaceAll(): void {
    const q = this.findInput?.value ?? "";
    if (!q) return;
    const repl = this.findReplaceInput?.value ?? "";
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    let n = 0;
    for (const c of this.doc.cues) {
      const next = c.text.replace(rx, repl);
      if (next !== c.text) {
        c.text = next;
        n += 1;
      }
    }
    if (n) {
      this.renderList();
      if (this.selectedId) this.refreshRow(this.selectedId);
      this.renderDetail();
      this.markDirty();
    }
    this.toast(t("replacedN", { n: String(n) }));
    this.runFind(q);
  }

  // --- problems panel ------------------------------------------------------

  private toggleProblems(): void {
    if (this.problemsPanel) {
      this.problemsPanel.remove();
      this.problemsPanel = null;
      this.problemsBtn?.classList.remove("on");
      return;
    }
    const panel = el("div", "se-problems") as HTMLDivElement;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", t("problems"));
    const issues = this.computeProblems();
    if (!issues.length) {
      panel.appendChild(el("div", "se-prob-empty", t("noProblems")));
    } else {
      for (const p of issues) {
        const row = el("div", "se-prob-row");
        row.appendChild(el("span", "se-prob-idx", String(p.index + 1)));
        row.appendChild(el("span", "se-prob-msg", p.msg));
        row.tabIndex = 0;
        const jump = () => {
          this.select(p.id);
          this.scrollCueIntoView(p.id);
        };
        row.addEventListener("click", jump);
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            jump();
          }
        });
        panel.appendChild(row);
      }
    }
    this.problemsPanel = panel;
    this.problemsBtn?.classList.add("on");
    this.root.appendChild(panel);
    // Drop the panel just below the whole toolbar so it never covers the buttons.
    const tb = this.root.querySelector(".se-toolbar");
    if (tb) {
      const b = tb.getBoundingClientRect();
      const r = this.root.getBoundingClientRect();
      panel.style.top = `${Math.round(b.bottom - r.top + 4)}px`;
    }
  }

  // Detect the common subtitle issues: overlaps with the next cue, too-fast reading speed,
  // and over-long duration. Returns them in document order, each with a jump target.
  private computeProblems(): { id: string; index: number; msg: string }[] {
    const out: { id: string; index: number; msg: string }[] = [];
    const cues = this.doc.cues;
    for (let i = 0; i < cues.length; i += 1) {
      const c = cues[i];
      const next = cues[i + 1];
      if (next && c.endMs > next.startMs) out.push({ id: c.id, index: i, msg: t("probOverlap") });
      if (cps(c) > CPS_BAD) out.push({ id: c.id, index: i, msg: t("probTooFast", { cps: cps(c).toFixed(0) }) });
      if (c.endMs - c.startMs > 7000) out.push({ id: c.id, index: i, msg: t("probTooLong") });
    }
    return out;
  }

  private shiftTimes(): void {
    const answer = prompt(t("shiftPrompt"), "0");
    if (answer === null) return;
    const delta = parseInt(answer, 10);
    if (Number.isNaN(delta) || delta === 0) return;
    for (const c of this.doc.cues) {
      c.startMs = Math.max(0, c.startMs + delta);
      c.endMs = Math.max(0, c.endMs + delta);
    }
    this.renderList();
    this.renderDetail();
    this.markDirty();
  }

  private fixOverlaps(): void {
    this.doc.cues = sortCues(this.doc.cues);
    let fixed = 0;
    for (let i = 1; i < this.doc.cues.length; i += 1) {
      const prev = this.doc.cues[i - 1];
      const cur = this.doc.cues[i];
      if (cur.startMs < prev.endMs) {
        prev.endMs = Math.min(prev.endMs, cur.startMs);
        fixed += 1;
      }
    }
    this.rows.clear();
    this.innerEl.textContent = "";
    this.renderList();
    this.renderDetail();
    if (fixed) this.markDirty();
    this.toast(t("overlapsFixed", { n: fixed }));
  }

  private setFormat(target: SubtitleFormat): void {
    if (target === this.doc.format) return;
    this.doc = convertDoc(this.doc, target);
    this.refreshForActiveDoc();
    this.markDirty();
  }

  private save(): void {
    const text = serializeSubtitles(this.doc);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `subtitles.${this.doc.format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // --- preview (minimal; upgraded to the mediaplay embed in a later phase) --

  private renderPreviewPlaceholder(): void {
    this.rightEl.textContent = "";
    const box = el("div", "se-noprev");
    box.appendChild(el("div", "", t("noVideo")));
    box.appendChild(el("div", "", t("loadVideoHint")));
    const btn = this.button(t("loadVideo"), () => this.pickVideo());
    box.appendChild(btn);
    this.rightEl.appendChild(box);
  }

  private pickVideo(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*,audio/*";
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      if (f) void this.loadVideo(f);
    });
    input.click();
  }

  // Load the video/audio into an embedded mediaplay player: this brings MKV/legacy remux,
  // Dolby/DTS audio decode and libass ASS rendering. embedded=true so the player's global
  // shortcuts and CC menu stay out of the editor's way; subedit drives subtitles via
  // setSubtitleText and reads currentTime from the underlying media element.
  private async loadVideo(file: File): Promise<void> {
    this.player?.destroy();
    this.video?.removeEventListener("timeupdate", this.onTimeUpdate);
    this.timeline?.stopPlayheadLoop();
    if (this.posOverlay) this.exitPosition();
    if (this.clipOverlay) this.exitClip();
    if (this.drawOverlay) this.exitDraw();
    this.rightEl.textContent = "";
    const host = el("div", "se-playerhost") as HTMLDivElement;
    this.rightEl.appendChild(host);
    this.mediaFile = file;
    // Read the file into memory only transiently, for the one-time embedded-track + waveform
    // extraction; it is not retained, so the file doesn't sit in RAM during editing. The player
    // gets the disk-backed File and streams from it.
    const bytes = new Uint8Array(await file.arrayBuffer());
    this.mediaContainer = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3 ? "mkv" : "mp4";
    this.loadEmbeddedTracks(bytes); // before the player, so subs load even if it can't decode the media
    this.player = createMediaPlayer(host, { blob: file, mime: file.type, filename: file.name }, { embedded: true });
    const v = this.player.getMediaElement() ?? null;
    this.video = v;
    if (v) {
      v.addEventListener("timeupdate", this.onTimeUpdate);
      v.addEventListener("loadedmetadata", () => {
        this.timeline?.fitAll();
        this.timeline?.render();
      });
      v.addEventListener("play", () => this.timeline?.startPlayheadLoop());
      v.addEventListener("pause", () => {
        this.timeline?.stopPlayheadLoop();
        this.timeline?.render();
      });
      v.addEventListener("seeked", () => this.timeline?.render());
    }
    this.pushSubtitles();
    void this.extractWaveform(bytes);
  }

  // Read subtitle tracks embedded in the media container and load each as an editable track:
  // MKV/WebM via mediaplay (styled ASS via the reconstructed assDoc), else a progressive MP4
  // via mp4subs. A lone empty placeholder track is replaced; otherwise they are appended.
  private loadEmbeddedTracks(bytes: Uint8Array): void {
    const made: Track[] = [];
    let mkv: MkvSubtitleTrack[] = [];
    try {
      mkv = extractMkvSubtitles(bytes);
    } catch {
      /* not an MKV */
    }
    for (const s of mkv) {
      const doc = s.assDoc ? parseSubtitles(s.assDoc, "embedded.ass") : parseSubtitles(s.vtt ?? "", "embedded.vtt");
      const lang = normalizeLang(s.language);
      made.push({ id: newTrackId(), label: (s.label || lang || `${t("track")} ${made.length + 1}`).trim(), language: lang, doc });
    }
    if (!made.length) {
      // Not Matroska (or no subs): try a progressive MP4/MOV.
      for (const s of extractMp4Subtitles(bytes)) {
        const lang = normalizeLang(s.language);
        made.push({ id: newTrackId(), label: lang || `${t("track")} ${made.length + 1}`, language: lang, doc: parseSubtitles(s.text, "embedded.vtt") });
      }
    }
    if (!made.length) return;
    const placeholder = this.tracks.length === 1 && this.tracks[0].doc.cues.length === 0;
    if (placeholder) this.tracks = made;
    else this.tracks.push(...made);
    this.activeTrackId = made[0].id;
    this.refreshForActiveDoc();
    this.renderTrackBar();
    this.toast(t("tracksLoaded", { n: made.length }));
  }

  // Decode the media's audio to a waveform via mediaplay, which handles every codec it can
  // play (incl. Dolby/DTS the browser can't decode) and streams the PCM so large files
  // don't buffer in memory. Aborts if another media file is loaded meanwhile.
  private async extractWaveform(bytes: Uint8Array): Promise<void> {
    this.waveAbort?.abort();
    const ac = new AbortController();
    this.waveAbort = ac;
    this.wavePeaks = null;
    this.timeline?.clearPeaks();
    this.setWaveStatus(t("extractingWave"));
    try {
      const result = await extractWaveformPeaks(bytes, {
        base: new URL("libav/", document.baseURI).toString(),
        signal: ac.signal,
        durationHint: this.video?.duration || undefined,
        onProgress: (r) => this.setWaveStatus(`${t("extractingWave")} ${Math.round(r * 100)}%`),
      });
      if (ac.signal.aborted) return;
      if (result?.peaks.length) {
        this.wavePeaks = result;
        this.timeline?.setPeaks(result.peaks, result.peaksPerSec);
      }
    } catch {
      /* leave the timeline peak-less */
    } finally {
      if (this.waveAbort === ac) {
        this.waveAbort = null;
        this.setWaveStatus("");
      }
    }
  }

  private setWaveStatus(text: string): void {
    if (this.waveStatusEl) this.waveStatusEl.textContent = text;
  }

  // Feed the current (serialized) document to the preview so it renders the live edits.
  private pushSubtitles(immediate = false): void {
    if (!this.player) return;
    window.clearTimeout(this.subtitleTimer);
    const send = () => this.player?.setSubtitleText(serializeSubtitles(this.doc), `subtitles.${this.doc.format}`);
    if (immediate) send();
    else this.subtitleTimer = window.setTimeout(send, 300);
  }

  private onTimeUpdate = (): void => {
    if (!this.video) return;
    const ms = this.video.currentTime * 1000;
    const active = this.doc.cues.find((c) => ms >= c.startMs && ms < c.endMs);
    const id = active?.id ?? null;
    if (id === this.playingId) return;
    const prev = this.playingId;
    this.playingId = id;
    if (prev) this.refreshRow(prev);
    if (id) this.refreshRow(id);
    // Keep the playing cue in view while the video actually plays, unless the user turned it off.
    if (id && this.followPlayback && !this.video.paused) this.scrollCueIntoView(id);
  };

  private seekTo(ms: number, play = false): void {
    if (this.video) {
      this.video.currentTime = ms / 1000;
      if (play) void this.video.play().catch(() => {});
      else this.timeline?.render();
    }
  }

  // --- video timing --------------------------------------------------------

  // Set the selected cue's start or end to the current playhead, keeping a minimal 1ms span.
  private setCueEdge(which: "start" | "end"): void {
    const cue = this.selectedCue();
    if (!cue) return;
    if (!this.video) {
      this.toast(t("timingNeedsVideo"));
      return;
    }
    const ms = Math.round(this.video.currentTime * 1000);
    if (which === "start") this.updateCue(cue.id, { startMs: Math.min(ms, cue.endMs - 1) });
    else this.updateCue(cue.id, { endMs: Math.max(ms, cue.startMs + 1) });
  }

  private playFromSelected(): void {
    const cue = this.selectedCue();
    if (!cue) return;
    if (!this.video) {
      this.toast(t("timingNeedsVideo"));
      return;
    }
    this.seekTo(cue.startMs, true);
  }

  private toggleFollow(): void {
    this.followPlayback = !this.followPlayback;
    this.followBtn?.classList.toggle("on", this.followPlayback);
    if (this.followPlayback && this.playingId) this.scrollCueIntoView(this.playingId);
  }

  private scrollCueIntoView(id: string): void {
    const i = this.doc.cues.findIndex((c) => c.id === id);
    if (i < 0) return;
    const top = i * ROW_H;
    const viewTop = this.scrollEl.scrollTop;
    const viewH = this.scrollEl.clientHeight;
    if (top < viewTop) this.scrollEl.scrollTop = top;
    else if (top + ROW_H > viewTop + viewH) this.scrollEl.scrollTop = top + ROW_H - viewH;
  }

  // --- keyboard ------------------------------------------------------------

  private onKeydown = (e: KeyboardEvent): void => {
    // Save shortcuts fire even while typing (and pre-empt the browser's own save dialog), but
    // only when subedit owns saving; when a host owns it (showSave:false), let the key pass so
    // the host handles it. Save-into-video only acts when a media file is actually loaded.
    if (this.opts.showSave !== false && SHORTCUTS.save.match(e)) {
      e.preventDefault();
      this.save();
      return;
    }
    if (this.mediaFile && SHORTCUTS.saveVideo.match(e)) {
      e.preventDefault();
      void this.saveIntoVideo();
      return;
    }
    if (SHORTCUTS.find.match(e)) {
      e.preventDefault();
      if (!this.findBar) this.toggleFind();
      else this.findInput?.focus();
      return;
    }

    const target = e.target as HTMLElement;
    const typing =
      target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
    if (typing) return; // let a focused text field keep its own native undo/redo

    // Undo/redo only claim the key when they have something to do, so an empty stack still
    // lets a host (e.g. Omnitext) handle it.
    if (SHORTCUTS.undo.match(e)) {
      if (this.canUndo()) {
        e.preventDefault();
        this.undo();
      }
      return;
    }
    if (SHORTCUTS.redo.match(e)) {
      if (this.canRedo()) {
        e.preventDefault();
        this.redo();
      }
      return;
    }

    if (SHORTCUTS.addCue.match(e)) {
      e.preventDefault();
      this.addCue();
    } else if (SHORTCUTS.removeCue.match(e)) {
      e.preventDefault();
      this.removeCue();
    } else if (SHORTCUTS.markIn.match(e)) {
      e.preventDefault();
      this.setCueEdge("start");
    } else if (SHORTCUTS.markOut.match(e)) {
      e.preventDefault();
      this.setCueEdge("end");
    } else if (SHORTCUTS.playCue.match(e)) {
      e.preventDefault();
      this.playFromSelected();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      this.moveSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.moveSelection(-1);
    } else if (e.key === " ") {
      if (this.video) {
        e.preventDefault();
        if (this.video.paused) void this.video.play().catch(() => {});
        else this.video.pause();
      }
    }
  };

  private moveSelection(delta: number): void {
    const i = this.doc.cues.findIndex((c) => c.id === this.selectedId);
    const next = Math.max(0, Math.min(this.doc.cues.length - 1, (i < 0 ? 0 : i) + delta));
    const cue = this.doc.cues[next];
    if (cue) this.select(cue.id);
  }

  // --- misc ----------------------------------------------------------------

  private selectedCue(): Cue | undefined {
    return this.doc.cues.find((c) => c.id === this.selectedId);
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "se-btn";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  // An icon-only toolbar button: SVG glyph + a title/aria-label tooltip. When the action has
  // a keyboard shortcut, the tooltip shows it in parentheses and aria-keyshortcuts exposes it
  // to assistive tech. mousedown is suppressed so clicking keeps focus/selection in the editor.
  private iconButton(svg: string, title: string, onClick: () => void, sc?: Shortcut): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "se-btn se-iconbtn";
    b.innerHTML = svg;
    b.title = sc ? `${title} (${sc.label})` : title;
    b.setAttribute("aria-label", title);
    if (sc) b.setAttribute("aria-keyshortcuts", sc.aria);
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", onClick);
    return b;
  }

  private toastEl: HTMLDivElement | null = null;
  private toastTimer = 0;

  // A non-blocking toast at the bottom of the editor. Announced politely for screen readers.
  private toast(msg: string): void {
    if (!this.toastEl) {
      this.toastEl = el("div", "se-toast") as HTMLDivElement;
      this.toastEl.setAttribute("role", "status");
      this.toastEl.setAttribute("aria-live", "polite");
      this.root.appendChild(this.toastEl);
    }
    this.toastEl.textContent = msg;
    void this.toastEl.offsetWidth; // restart the fade-in even on a back-to-back toast
    this.toastEl.classList.add("on");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl?.classList.remove("on"), 2600);
  }

  private markDirty(): void {
    this.countEl.textContent = t("cueCount", { n: this.doc.cues.length });
    this.pushSubtitles();
    this.opts.onChange?.();
    this.scheduleHistory();
  }

  // --- undo / redo ---------------------------------------------------------

  private snapshot(): HistorySnap {
    return {
      tracks: this.tracks.map((tr) => ({ id: tr.id, label: tr.label, language: tr.language, doc: structuredClone(tr.doc) })),
      activeTrackId: this.activeTrackId,
      selectedId: this.selectedId,
    };
  }

  // Called from markDirty on every edit. The first edit after a quiet period records the
  // pre-edit baseline; a 500ms timer commits the group so rapid edits (typing) merge into one.
  private scheduleHistory(): void {
    if (this.restoring) return;
    if (!this.histTimer) {
      if (this.histBaseline) {
        this.undoStack.push(this.histBaseline);
        if (this.undoStack.length > HIST_MAX) this.undoStack.shift();
      }
      this.redoStack = [];
    }
    window.clearTimeout(this.histTimer);
    this.histTimer = window.setTimeout(() => {
      this.histBaseline = this.snapshot();
      this.histTimer = 0;
      this.updateHistoryButtons();
    }, 500);
    this.updateHistoryButtons();
  }

  private undo(): void {
    if (this.histTimer) {
      window.clearTimeout(this.histTimer);
      this.histTimer = 0;
    }
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshot());
    this.restoreSnap(prev);
    this.histBaseline = prev;
    this.updateHistoryButtons();
  }

  private redo(): void {
    if (this.histTimer) {
      window.clearTimeout(this.histTimer);
      this.histTimer = 0;
    }
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restoreSnap(next);
    this.histBaseline = next;
    this.updateHistoryButtons();
  }

  private canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  private canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private restoreSnap(snap: HistorySnap): void {
    this.restoring = true;
    this.tracks = snap.tracks.map((tr) => ({ id: tr.id, label: tr.label, language: tr.language, doc: structuredClone(tr.doc) }));
    this.activeTrackId = this.tracks.some((tr) => tr.id === snap.activeTrackId) ? snap.activeTrackId : (this.tracks[0]?.id ?? "");
    this.renderTrackBar();
    this.refreshForActiveDoc(); // re-selects cues[0]; restore the saved selection if it survives
    if (snap.selectedId && this.doc.cues.some((c) => c.id === snap.selectedId)) this.select(snap.selectedId);
    this.pushSubtitles(true);
    this.opts.onChange?.();
    this.restoring = false;
  }

  private updateHistoryButtons(): void {
    if (this.undoBtn) this.undoBtn.disabled = !this.canUndo();
    if (this.redoBtn) this.redoBtn.disabled = !this.canRedo();
  }

  // --- public API ----------------------------------------------------------

  getText(): string {
    return serializeSubtitles(this.doc);
  }
  getDoc(): SubtitleDoc {
    return this.doc;
  }
  loadPreviewMedia(file: File): void {
    void this.loadVideo(file);
  }
  focus(): void {
    this.root.focus();
  }
  destroy(): void {
    window.clearTimeout(this.subtitleTimer);
    window.clearTimeout(this.toastTimer);
    window.clearTimeout(this.histTimer);
    document.removeEventListener("keydown", this.onPosKey, true);
    document.removeEventListener("keydown", this.onClipKey, true);
    document.removeEventListener("keydown", this.onDrawKey, true);
    this.waveAbort?.abort();
    this.video?.removeEventListener("timeupdate", this.onTimeUpdate);
    this.timeline?.destroy();
    this.timeline = null;
    this.player?.destroy();
    this.player = null;
    this.root.remove();
  }
}

function el(tag: string, className = "", text = ""): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function createSubtitleEditor(
  container: HTMLElement,
  input: SubtitleInput,
  opts: SubtitleEditorOptions = {},
): SubtitleEditorHandle {
  return new SubtitleEditor(container, input, opts);
}

// newCueId is re-exported for hosts that build cues headlessly.
export { newCueId };
