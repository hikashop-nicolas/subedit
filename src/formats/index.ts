// Format dispatch: pick a parser/serializer from the filename or content, and expose
// a single parse/serialize pair the editor uses regardless of the underlying format.

import { type Cue, type SubtitleDoc, type SubtitleFormat, decodeCharRefs, encodeCharRefs } from "../cue";
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
import { parseTmp, serializeTmp } from "./tmp";
import { parseCsvSubs, serializeCsvSubs } from "./csv";
import { parseQtText, serializeQtText } from "./qttext";
import { parseDvdStudio, serializeDvdStudio } from "./dvdsp";
import { parseJsonSubs, serializeJsonSubs } from "./jsonsub";
import { parseTtxt, serializeTtxt } from "./ttxt";

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
  if (ext === "json") return /"tStartMs"/.test(head) ? "ytjson" : "jsonsub";
  if (ext === "stl") return "spruce";
  if (ext === "csv") return "csv";
  if (ext === "ttxt") return "ttxt";
  if (ext === "sub") return !isMicroDvd && isSubViewer ? "subviewer" : "sub";
  // Content sniff (no / unknown extension). Specific / structured patterns come first.
  if (/^\{QTtext\}/i.test(head)) return "qttext";
  if (/^WEBVTT(\s|$)/.test(head)) return "vtt";
  if (/^\[script info\]/i.test(head) || /^scripttype\s*:/im.test(head)) return "ass";
  if (/<sami[\s>]/i.test(head)) return "sami";
  if (/<TextStream[\s>]|<TextSample\b/i.test(head)) return "ttxt";
  if (/<tt[\s>]/i.test(head)) return "ttml";
  if (/"tStartMs"/.test(head)) return "ytjson";
  if (/^\s*\[[\s\S]*?"text"/.test(head) && /"start(Ms)?"|"from"/.test(head)) return "jsonsub";
  if (isMicroDvd) return "sub";
  if (/^\[\d+\]\[\d+\]/m.test(head)) return "mpl2";
  // Frame timecodes: DVD Studio Pro has spaces around the commas; Spruce doesn't. Both must be
  // checked before TMPlayer, whose looser "HH:MM:SS:" pattern would otherwise swallow them.
  if (/^\d{2}:\d{2}:\d{2}:\d{2}\s+,\s+\d{2}:\d{2}:\d{2}:\d{2}\s+,/m.test(head)) return "dvdsp";
  if (/^\d{2}:\d{2}:\d{2}:\d{2},\d{2}:\d{2}:\d{2}:\d{2},/m.test(head)) return "spruce";
  if (isSubViewer) return "subviewer";
  if (/^\d{1,2}:\d{2}:\d{2}[.,]\d{3},\d{1,2}:\d{2}:\d{2}[.,]\d{3}/m.test(head)) return "sbv";
  if (/^\d{1,2}:\d{2}:\d{2}[:=]/m.test(head)) return "tmp";
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
  if (fmt === "tmp") return parseTmp(text);
  if (fmt === "csv") return parseCsvSubs(text);
  if (fmt === "qttext") return parseQtText(text);
  if (fmt === "dvdsp") return parseDvdStudio(text);
  if (fmt === "jsonsub") return parseJsonSubs(text);
  if (fmt === "ttxt") return parseTtxt(text);
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
  if (doc.format === "tmp") return serializeTmp(doc);
  if (doc.format === "csv") return serializeCsvSubs(doc);
  if (doc.format === "qttext") return serializeQtText(doc);
  if (doc.format === "dvdsp") return serializeDvdStudio(doc);
  if (doc.format === "jsonsub") return serializeJsonSubs(doc);
  if (doc.format === "ttxt") return serializeTtxt(doc);
  return serializeSrt(doc);
}

// Formats whose timecodes are frame numbers rather than times.
const FRAME_BASED = new Set<SubtitleFormat>(["sub", "spruce", "dvdsp"]);

// The rate to declare when converting into one of them and the source had none to carry over.
//
// Not the same as the rate each format ASSUMES when a file stays silent (23.976 for MicroDVD,
// 25 for the other two): that one has to keep reading existing files the way it always has.
// This one is a free choice, and 25 is the better one, because a whole second is exactly 25
// frames while at 23.976 it is 23.976 of them. Writing 23.976 would land every whole-second
// cue a millisecond out, for no reason other than an arbitrary default.
const CONVERT_FPS = 25;

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
  // VTT stores "&amp;" and "&lt;" escaped, and is the only text-verbatim format that does.
  // Carrying them into a format with no character references would show them literally, and
  // carrying a bare "&" into VTT would leave a file that does not conform.
  const fromVtt = doc.format === "vtt";
  const toVtt = target === "vtt";
  next.assFormat = undefined;
  next.assStyleFormat = undefined;
  next.assScriptInfo = undefined;
  next.assStylesTail = undefined;
  next.styles = undefined;
  // A frame-based target needs a frame rate written into the file. Converting from a
  // time-based format there is nothing to carry over, and leaving it out makes every time in
  // the file depend on whatever rate the reader happens to assume: at 25 against 23.976 that
  // is a drift of 4%, over two seconds by the end of a film. So declare one rather than
  // leave the file ambiguous.
  next.fps = FRAME_BASED.has(target) ? (doc.fps ?? CONVERT_FPS) : undefined;

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
      text: (fromVtt ? decodeCharRefs(c.text) : c.text).replace(/\r?\n/g, "\\N"),
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
      text: toVtt
        ? encodeCharRefs(fromAss ? plainFromAss(c.text) : c.text)
        : fromAss
          ? plainFromAss(c.text)
          : fromVtt
            ? decodeCharRefs(c.text)
            : c.text,
    }));
  return next;
}
