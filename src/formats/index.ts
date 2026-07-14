// Format dispatch: pick a parser/serializer from the filename or content, and expose
// a single parse/serialize pair the editor uses regardless of the underlying format.

import type { Cue, SubtitleDoc, SubtitleFormat } from "../cue";
import { parseSrt, serializeSrt } from "./srt";
import { parseVtt, serializeVtt } from "./vtt";
import { parseAss, serializeAss, defaultAssParts, ASS_EVENT_FORMAT, DEFAULT_STYLE_FORMAT } from "./ass";
import { parseMicroDvd, serializeMicroDvd } from "./microdvd";
import { parseLrc, serializeLrc } from "./lrc";
import { parseTtml, serializeTtml } from "./ttml";
import { parseSbv, serializeSbv } from "./sbv";
import { parseMpl2, serializeMpl2 } from "./mpl2";
import { parseSubViewer, serializeSubViewer } from "./subviewer";
import { parseSami, serializeSami } from "./sami";
import { parseYtJson, serializeYtJson } from "./youtube";
import { parseSpruce, serializeSpruce } from "./spruce";

export function detectFormat(filename: string | undefined, sample: string): SubtitleFormat {
  const ext = (filename ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const head = sample.replace(/^﻿/, "").trimStart();
  const isMicroDvd = /^\{\d+\}\{\d+\}/m.test(head);
  const isSubViewer = /^\[INFORMATION\]/i.test(head) || /^\d{1,2}:\d{2}:\d{2}[.,]\d{1,2},\d{1,2}:\d{2}:\d{2}[.,]\d{1,2}\s*$/m.test(head);
  // Extension first, disambiguating the shared ".sub" (MicroDVD vs SubViewer) by content.
  if (ext === "vtt") return "vtt";
  if (ext === "srt") return "srt";
  if (ext === "ass" || ext === "ssa") return "ass";
  if (ext === "lrc") return "lrc";
  if (ext === "ttml" || ext === "dfxp") return "ttml";
  if (ext === "sbv") return "sbv";
  if (ext === "smi" || ext === "sami") return "sami";
  if (ext === "mpl" || ext === "mpl2") return "mpl2";
  if (ext === "srv3" || ext === "json3") return "ytjson";
  if (ext === "stl") return "spruce";
  if (ext === "sub") return !isMicroDvd && isSubViewer ? "subviewer" : "sub";
  // Content sniff (no / unknown extension).
  if (/^WEBVTT(\s|$)/.test(head)) return "vtt";
  if (/^\[script info\]/i.test(head) || /^scripttype\s*:/im.test(head)) return "ass";
  if (/<sami[\s>]/i.test(head)) return "sami";
  if (/<tt[\s>]/i.test(head)) return "ttml";
  if (/"tStartMs"/.test(head)) return "ytjson";
  if (isMicroDvd) return "sub";
  if (/^\[\d+\]\[\d+\]/m.test(head)) return "mpl2";
  if (/^\d{2}:\d{2}:\d{2}:\d{2},\d{2}:\d{2}:\d{2}:\d{2},/m.test(head)) return "spruce";
  if (isSubViewer) return "subviewer";
  if (/^\d{1,2}:\d{2}:\d{2}[.,]\d{3},\d{1,2}:\d{2}:\d{2}[.,]\d{3}/m.test(head)) return "sbv";
  if (/^(?:\[[a-z#]+:[^\]]*\]\s*)*\[\d{1,2}:\d{2}[.:]/i.test(head)) return "lrc";
  return "srt";
}

export function parseSubtitles(text: string, filename?: string): SubtitleDoc {
  const fmt = detectFormat(filename, text.slice(0, 256));
  if (fmt === "vtt") return parseVtt(text);
  if (fmt === "ass") return parseAss(text);
  if (fmt === "sub") return parseMicroDvd(text);
  if (fmt === "lrc") return parseLrc(text);
  if (fmt === "ttml") return parseTtml(text);
  if (fmt === "sbv") return parseSbv(text);
  if (fmt === "mpl2") return parseMpl2(text);
  if (fmt === "subviewer") return parseSubViewer(text);
  if (fmt === "sami") return parseSami(text);
  if (fmt === "ytjson") return parseYtJson(text);
  if (fmt === "spruce") return parseSpruce(text);
  return parseSrt(text);
}

export function serializeSubtitles(doc: SubtitleDoc): string {
  if (doc.format === "vtt") return serializeVtt(doc);
  if (doc.format === "ass") return serializeAss(doc);
  if (doc.format === "sub") return serializeMicroDvd(doc);
  if (doc.format === "lrc") return serializeLrc(doc);
  if (doc.format === "ttml") return serializeTtml(doc);
  if (doc.format === "sbv") return serializeSbv(doc);
  if (doc.format === "mpl2") return serializeMpl2(doc);
  if (doc.format === "subviewer") return serializeSubViewer(doc);
  if (doc.format === "sami") return serializeSami(doc);
  if (doc.format === "ytjson") return serializeYtJson(doc);
  if (doc.format === "spruce") return serializeSpruce(doc);
  return serializeSrt(doc);
}

// Strip ASS override tags and normalize \N line breaks, for converting ASS text to the
// plain text SRT/VTT expect.
function plainFromAss(text: string): string {
  return text.replace(/\{[^}]*\}/g, "").replace(/\\N/g, "\n").replace(/\\h/g, " ");
}

// Convert a parsed doc to a different format in place (used by the format switcher).
// Trivia that does not apply to the target is dropped.
export function convertDoc(doc: SubtitleDoc, target: SubtitleFormat): SubtitleDoc {
  if (doc.format === target) return doc;
  const next: SubtitleDoc = { ...doc, format: target };
  const fromAss = doc.format === "ass";
  next.assFormat = undefined;
  next.assStyleFormat = undefined;
  next.assScriptInfo = undefined;
  next.assStylesTail = undefined;
  next.styles = undefined;
  next.fps = target === "sub" || target === "spruce" ? doc.fps : undefined;

  if (target === "ass") {
    const parts = defaultAssParts(doc.eol);
    next.header = undefined;
    next.assScriptInfo = parts.scriptInfo;
    next.styles = parts.styles;
    next.assStylesTail = parts.tail;
    next.assStyleFormat = DEFAULT_STYLE_FORMAT;
    next.assFormat = ASS_EVENT_FORMAT;
    next.trailingNotes = undefined;
    next.cues = doc.cues.map((c) => ({
      ...c,
      identifier: undefined,
      settings: undefined,
      notesBefore: undefined,
      text: c.text.replace(/\r?\n/g, "\\N"),
      assKind: "Dialogue" as const,
      assFields: { Layer: "0", Style: "Default", Name: "", MarginL: "0", MarginR: "0", MarginV: "0", Effect: "" },
    }));
    return next;
  }

  // Target is SRT or VTT: drop commented (disabled) ASS cues, they have no equivalent.
  next.header = target === "vtt" ? "WEBVTT" : undefined;
  next.trailingNotes = undefined;
  next.cues = doc.cues
    .filter((c) => c.assKind !== "Comment")
    .map((c): Cue => ({
      ...c,
      identifier: undefined,
      settings: undefined,
      notesBefore: undefined,
      assKind: undefined,
      assFields: undefined,
      text: fromAss ? plainFromAss(c.text) : c.text,
    }));
  return next;
}
