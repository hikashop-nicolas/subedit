// Format dispatch: pick a parser/serializer from the filename or content, and expose
// a single parse/serialize pair the editor uses regardless of the underlying format.

import type { SubtitleDoc, SubtitleFormat } from "./cue";
import { parseSrt, serializeSrt } from "./srt";
import { parseVtt, serializeVtt } from "./vtt";

export function detectFormat(filename: string | undefined, sample: string): SubtitleFormat {
  const ext = (filename ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === "vtt") return "vtt";
  if (ext === "srt") return "srt";
  // Content sniff: a WEBVTT signature wins; otherwise default to SRT.
  const head = sample.replace(/^﻿/, "").trimStart();
  if (/^WEBVTT(\s|$)/.test(head)) return "vtt";
  return "srt";
}

export function parseSubtitles(text: string, filename?: string): SubtitleDoc {
  return detectFormat(filename, text.slice(0, 64)) === "vtt" ? parseVtt(text) : parseSrt(text);
}

export function serializeSubtitles(doc: SubtitleDoc): string {
  return doc.format === "vtt" ? serializeVtt(doc) : serializeSrt(doc);
}

// Convert a parsed doc to a different format in place (used by the format switcher).
// Trivia that does not apply to the target is dropped.
export function convertDoc(doc: SubtitleDoc, target: SubtitleFormat): SubtitleDoc {
  if (doc.format === target) return doc;
  const next: SubtitleDoc = { ...doc, format: target };
  if (target === "srt") {
    next.header = undefined;
    next.trailingNotes = undefined;
    next.cues = doc.cues.map((c) => ({ ...c, identifier: undefined, notesBefore: undefined }));
  } else {
    next.header = "WEBVTT";
  }
  return next;
}
