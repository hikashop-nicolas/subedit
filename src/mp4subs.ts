// Extract text subtitle tracks from an MP4/MOV, both progressive (moov/stbl sample tables)
// and fragmented (moof/traf/trun). codem-isoboxer parses the box tree; for progressive files
// we read the sample tables it doesn't parse (stsc/stsz/stco/co64) from raw bytes, for
// fragmented files we use its parsed trun/tfhd/tfdt. Each sample is decoded per its format
// (tx3g/mov_text or wvtt/WebVTT) and emitted as a WebVTT document.
import ISOBoxer, { type ISOBox, type ISOFile } from "codem-isoboxer";

interface RawSample {
  offset: number;
  size: number;
  startTicks: number;
  durTicks: number;
}

export interface Mp4SubTrack {
  label: string;
  language: string;
  format: "vtt";
  text: string; // a WebVTT document
}

interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

const utf8 = (b: Uint8Array): string => new TextDecoder("utf-8").decode(b);

// --- pure helpers (unit-tested) ------------------------------------------------------

// Absolute file offset + byte size of every sample, from the sample-to-chunk map.
export function sampleOffsets(stsc: { firstChunk: number; samplesPerChunk: number }[], chunkOffsets: number[], sampleSizes: number[]): { offset: number; size: number }[] {
  const nChunks = chunkOffsets.length;
  const perChunk = new Array(nChunks).fill(0);
  for (let i = 0; i < stsc.length; i++) {
    const start = stsc[i].firstChunk; // 1-based
    const end = i + 1 < stsc.length ? stsc[i + 1].firstChunk : nChunks + 1;
    for (let c = start; c < end && c - 1 < nChunks; c++) perChunk[c - 1] = stsc[i].samplesPerChunk;
  }
  const out: { offset: number; size: number }[] = [];
  let s = 0;
  for (let c = 0; c < nChunks; c++) {
    let off = chunkOffsets[c];
    for (let k = 0; k < perChunk[c] && s < sampleSizes.length; k++) {
      out.push({ offset: off, size: sampleSizes[s] });
      off += sampleSizes[s];
      s++;
    }
  }
  return out;
}

// Start + duration (ms) of every sample, from the time-to-sample table.
export function sampleTimesMs(stts: { count: number; delta: number }[], timescale: number): { startMs: number; durMs: number }[] {
  const ts = timescale || 1000;
  const out: { startMs: number; durMs: number }[] = [];
  let t = 0;
  for (const e of stts) {
    for (let i = 0; i < e.count; i++) {
      out.push({ startMs: Math.round((t / ts) * 1000), durMs: Math.round((e.delta / ts) * 1000) });
      t += e.delta;
    }
  }
  return out;
}

// Per-sample durations (in timescale ticks) expanded from the time-to-sample table.
export function expandStts(stts: { count: number; delta: number }[]): number[] {
  const out: number[] = [];
  for (const e of stts) for (let i = 0; i < e.count; i++) out.push(e.delta);
  return out;
}

// tx3g / mov_text sample: a 16-bit length prefix then UTF-8 text (style boxes ignored).
export function decodeTx3g(sample: Uint8Array): string {
  if (sample.byteLength < 2) return "";
  const len = (sample[0] << 8) | sample[1];
  if (len === 0) return "";
  return utf8(sample.subarray(2, Math.min(2 + len, sample.byteLength)));
}

// wvtt sample: a sequence of boxes; each 'vttc' cue box holds a 'payl' payload box.
export function decodeWvtt(sample: Uint8Array): string {
  const texts: string[] = [];
  walkBoxes(sample, (type, payload) => {
    if (type === "vttc") walkBoxes(payload, (t2, p2) => t2 === "payl" && texts.push(utf8(p2)));
  });
  return texts.join("\n");
}

function walkBoxes(buf: Uint8Array, cb: (type: string, payload: Uint8Array) => void): void {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 0;
  while (o + 8 <= buf.byteLength) {
    const size = dv.getUint32(o);
    const type = String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]);
    if (size < 8 || o + size > buf.byteLength) break;
    cb(type, buf.subarray(o + 8, o + size));
    o += size;
  }
}

const LANG3TO2: Record<string, string> = { eng: "en", fra: "fr", fre: "fr", jpn: "ja", spa: "es", deu: "de", ger: "de", ita: "it", por: "pt", nld: "nl", dut: "nl", rus: "ru", zho: "zh", chi: "zh", kor: "ko", ara: "ar" };

export function decodeMdhdLanguage(lang: number | string | undefined): string {
  let code = "";
  if (typeof lang === "string") code = lang;
  else if (typeof lang === "number" && lang > 0) {
    code = [(lang >> 10) & 0x1f, (lang >> 5) & 0x1f, lang & 0x1f].map((x) => String.fromCharCode(x + 0x60)).join("");
  }
  code = code.toLowerCase().replace(/[^a-z]/g, "");
  if (!code || code === "und") return "";
  return LANG3TO2[code] ?? code;
}

function fmtTs(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mm = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}.${p(mm, 3)}`;
}

export function cuesToVtt(cues: Cue[]): string {
  return "WEBVTT\n\n" + cues.map((c) => `${fmtTs(c.startMs)} --> ${fmtTs(Math.max(c.endMs, c.startMs + 1))}\n${c.text}`).join("\n\n") + "\n";
}

// --- box-tree glue -------------------------------------------------------------------

function descend(box: ISOBox, type: string): ISOBox[] {
  const out: ISOBox[] = [];
  const rec = (b: ISOBox): void => {
    for (const c of b.boxes ?? []) {
      if (c.type === type) out.push(c);
      rec(c);
    }
  };
  rec(box);
  return out;
}
const first = (box: ISOBox, type: string): ISOBox | undefined => descend(box, type)[0];

// Read a not-natively-parsed box (stsc/stsz/stco/co64) straight from the file bytes.
function boxView(ab: ArrayBuffer, box: ISOBox): DataView {
  return new DataView(ab, box._offset, box.size);
}
function parseStsc(dv: DataView): { firstChunk: number; samplesPerChunk: number }[] {
  const n = dv.getUint32(12);
  const out = [];
  for (let i = 0; i < n; i++) out.push({ firstChunk: dv.getUint32(16 + i * 12), samplesPerChunk: dv.getUint32(16 + i * 12 + 4) });
  return out;
}
function parseStsz(dv: DataView): number[] {
  const uniform = dv.getUint32(12);
  const count = dv.getUint32(16);
  if (uniform) return new Array(count).fill(uniform);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(dv.getUint32(20 + i * 4));
  return out;
}
function parseStco(dv: DataView, is64: boolean): number[] {
  const n = dv.getUint32(12);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(is64 ? Number(dv.getBigUint64(16 + i * 8)) : dv.getUint32(16 + i * 4));
  return out;
}

const SUBTITLE_HANDLERS = new Set(["sbtl", "text", "subt"]);

// Samples held in the classic sample tables (moov/stbl), if present.
function progressiveSamples(ab: ArrayBuffer, trak: ISOBox): RawSample[] {
  const stbl = first(trak, "stbl");
  const stts = stbl && first(stbl, "stts");
  const stsc = stbl && first(stbl, "stsc");
  const stsz = stbl && first(stbl, "stsz");
  const stco = stbl && (first(stbl, "stco") ?? first(stbl, "co64"));
  if (!stbl || !stts || !stsc || !stsz || !stco) return [];
  const offs = sampleOffsets(parseStsc(boxView(ab, stsc)), parseStco(boxView(ab, stco), stco.type === "co64"), parseStsz(boxView(ab, stsz)));
  const durs = expandStts((stts.entries ?? []).map((e) => ({ count: e.sample_count ?? 0, delta: e.sample_delta ?? 0 })));
  const out: RawSample[] = [];
  let t = 0;
  for (let i = 0; i < offs.length; i++) {
    const d = durs[i] ?? 0;
    out.push({ offset: offs[i].offset, size: offs[i].size, startTicks: t, durTicks: d });
    t += d;
  }
  return out;
}

// Samples spread across movie fragments (moof/traf/trun) for the given track.
function fragmentedSamples(file: ISOFile, trackID: number, defaults: { dur: number; size: number }): RawSample[] {
  const out: RawSample[] = [];
  let running = 0;
  for (const moof of descend(file, "moof")) {
    for (const traf of descend(moof, "traf")) {
      const tfhd = first(traf, "tfhd");
      if (!tfhd || tfhd.track_ID !== trackID) continue;
      const trun = first(traf, "trun");
      if (!trun) continue;
      const flags = tfhd.flags ?? 0;
      const base = flags & 0x01 ? Number(tfhd.base_data_offset) : moof._offset; // else default-base-is-moof
      let off = base + Number(trun.data_offset ?? 0);
      let t = Number(first(traf, "tfdt")?.baseMediaDecodeTime ?? running);
      const defDur = tfhd.default_sample_duration ?? defaults.dur;
      const defSize = tfhd.default_sample_size ?? defaults.size;
      for (const s of trun.samples ?? []) {
        const size = s.sample_size ?? defSize ?? 0;
        const dur = s.sample_duration ?? defDur ?? 0;
        out.push({ offset: off, size, startTicks: t, durTicks: dur });
        off += size;
        t += dur;
      }
      running = t;
    }
  }
  return out;
}

export function extractMp4Subtitles(bytes: Uint8Array): Mp4SubTrack[] {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  let file: ISOFile;
  try {
    file = ISOBoxer.parseBuffer(ab);
  } catch {
    return [];
  }
  const trexList = descend(file, "trex");
  const out: Mp4SubTrack[] = [];
  for (const trak of descend(file, "trak")) {
    const hdlr = first(trak, "hdlr");
    if (!hdlr || !SUBTITLE_HANDLERS.has((hdlr.handler_type ?? "").trim())) continue;
    const codec = first(first(trak, "stbl") ?? trak, "stsd")?.entries?.[0]?.type ?? "";
    const timescale = first(trak, "mdhd")?.timescale ?? 1000;
    const language = decodeMdhdLanguage(first(trak, "mdhd")?.language);
    const trackID = first(trak, "tkhd")?.track_ID ?? 0;
    const trex = trexList.find((x) => x.track_ID === trackID);
    const samples = [
      ...progressiveSamples(ab, trak),
      ...fragmentedSamples(file, trackID, { dur: trex?.default_sample_duration ?? 0, size: trex?.default_sample_size ?? 0 }),
    ].sort((a, b) => a.startTicks - b.startTicks);

    const cues: Cue[] = [];
    for (const s of samples) {
      if (s.offset + s.size > ab.byteLength) continue;
      const sample = new Uint8Array(ab, s.offset, s.size);
      const text = codec === "wvtt" ? decodeWvtt(sample) : decodeTx3g(sample);
      if (text.trim()) cues.push({ startMs: Math.round((s.startTicks / timescale) * 1000), endMs: Math.round(((s.startTicks + s.durTicks) / timescale) * 1000), text: text.trim() });
    }
    if (cues.length) out.push({ label: language || "subtitle", language, format: "vtt", text: cuesToVtt(cues) });
  }
  return out;
}
