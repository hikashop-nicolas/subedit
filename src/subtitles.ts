// Format dispatch: pick a parser/serializer from the filename or content, and expose
// a single parse/serialize pair the editor uses regardless of the underlying format.

import type { Cue, SubtitleDoc, SubtitleFormat } from "./cue";
import { parseSrt, serializeSrt } from "./srt";
import { parseVtt, serializeVtt } from "./vtt";
import { parseAss, serializeAss, defaultAssParts, ASS_EVENT_FORMAT, DEFAULT_STYLE_FORMAT } from "./ass";

export function detectFormat(filename: string | undefined, sample: string): SubtitleFormat {
  const ext = (filename ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === "vtt") return "vtt";
  if (ext === "srt") return "srt";
  if (ext === "ass" || ext === "ssa") return "ass";
  // Content sniff.
  const head = sample.replace(/^﻿/, "").trimStart();
  if (/^WEBVTT(\s|$)/.test(head)) return "vtt";
  if (/^\[script info\]/i.test(head) || /^scripttype\s*:/im.test(head)) return "ass";
  return "srt";
}

export function parseSubtitles(text: string, filename?: string): SubtitleDoc {
  const fmt = detectFormat(filename, text.slice(0, 256));
  if (fmt === "vtt") return parseVtt(text);
  if (fmt === "ass") return parseAss(text);
  return parseSrt(text);
}

export function serializeSubtitles(doc: SubtitleDoc): string {
  if (doc.format === "vtt") return serializeVtt(doc);
  if (doc.format === "ass") return serializeAss(doc);
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
      assFields: { Layer: "0", Style: "Default", Name: "", MarginL: "0", MarginR: "0", MarginV: "0", Effect: "" },
    }));
    return next;
  }

  // Target is SRT or VTT.
  next.header = target === "vtt" ? "WEBVTT" : undefined;
  next.trailingNotes = undefined;
  next.cues = doc.cues.map((c): Cue => ({
    ...c,
    identifier: undefined,
    settings: undefined,
    notesBefore: undefined,
    assFields: undefined,
    text: fromAss ? plainFromAss(c.text) : c.text,
  }));
  return next;
}
