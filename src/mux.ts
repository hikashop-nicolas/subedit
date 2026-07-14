// Mux subtitle tracks back into the media container. Stream-copies the input's video and
// audio packets (no re-encode) via mediabunny and writes our subtitle tracks alongside.
// v1 writes WebVTT subtitle tracks (plain text); styled ASS-in-MKV waits on the mediabunny
// S_TEXT/ASS fork, and MP4 subtitle output waits on the fork's WebVTT-assert fix.
import {
  Input,
  Output,
  BlobSource,
  BufferTarget,
  StreamTarget,
  ALL_FORMATS,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  TextSubtitleSource,
  MkvOutputFormat,
  Mp4OutputFormat,
  type OutputFormat,
  type EncodedPacket,
  type Target,
  type StreamTargetChunk,
} from "mediabunny";

// A subset of FileSystemWritableFileStream (from showSaveFilePicker) that we use.
export interface FileWritable {
  write(chunk: StreamTargetChunk): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

export type MuxContainer = "mkv" | "mp4";

export interface MuxSubtitle {
  name: string;
  language: string; // 2-letter code or ""
  // "ass" writes a styled S_TEXT/ASS track (MKV only); "vtt" writes a WebVTT track.
  kind: "ass" | "vtt";
  content: string; // the ASS document or the WebVTT document
}

// 2-letter -> ISO 639-2/T for mediabunny's track metadata.
const LANG2TO3: Record<string, string> = { en: "eng", fr: "fra", ja: "jpn", es: "spa", de: "deu", it: "ita", pt: "por", nl: "nld", ru: "rus", zh: "zho", ko: "kor", ar: "ara" };

// The source media, ideally as a disk-backed Blob/File so BlobSource streams it without ever
// loading the whole (multi-GB) file into memory. A Uint8Array is accepted too but is wrapped in
// a Blob, which copies it.
export type MuxMedia = Blob | Uint8Array;

// Buffer the whole output in memory and return it. Fine for typical files; the buffer target
// supports random access so the output is seekable (Cues/moov in place).
export async function muxIntoContainer(media: MuxMedia, subs: MuxSubtitle[], container: MuxContainer): Promise<Uint8Array> {
  const target = new BufferTarget();
  await runMux(media, subs, container, target, false);
  return new Uint8Array(target.buffer as ArrayBuffer);
}

// Stream the output straight to a file (showSaveFilePicker handle), so multi-GB saves never
// buffer the whole result in RAM. StreamTarget's chunks match FileSystemWritableFileStream.
// Uses append-only output (forward-only writes, unknown-size elements): without it the muxer
// seeks backward to patch cluster/segment sizes, which a forward stream can't do, so it would
// buffer the ENTIRE file and flush nothing until finalize (a multi-GB stall / 0-byte file).
export async function muxToFile(media: MuxMedia, subs: MuxSubtitle[], container: MuxContainer, file: FileWritable, onBytes?: (written: number) => void): Promise<void> {
  let written = 0;
  const stream = new WritableStream<StreamTargetChunk>({
    write: (chunk) => {
      written += chunk.data.byteLength;
      onBytes?.(written);
      return file.write(chunk);
    },
    close: () => file.close(),
    abort: (reason) => file.abort?.(reason) ?? Promise.resolve(),
  });
  await runMux(media, subs, container, new StreamTarget(stream), true);
}

async function runMux(media: MuxMedia, subs: MuxSubtitle[], container: MuxContainer, target: Target, appendOnly: boolean): Promise<void> {
  // A Blob/File is read on demand by BlobSource (no full in-memory copy); a Uint8Array must be
  // wrapped, which copies it once.
  const blob = media instanceof Blob ? media : new Blob([media as BlobPart]);
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  // MKV needs appendOnly to stream (else it seeks back to patch sizes and buffers everything).
  // MP4 needs nothing: mediabunny defaults a StreamTarget to fastStart:false (moov at the end,
  // forward-only) and a BufferTarget to in-memory fast start, both correct for their path.
  const format: OutputFormat = container === "mp4" ? new Mp4OutputFormat() : new MkvOutputFormat({ appendOnly });
  const output = new Output({ format, target });

  // Stream-copy every video / audio track (no decode/encode).
  const copies: { sink: EncodedPacketSink; add: (p: EncodedPacket, meta?: unknown) => Promise<void>; meta: unknown }[] = [];
  for (const tr of await input.getTracks()) {
    if (tr.isVideoTrack()) {
      const codec = await tr.getCodec();
      if (!codec) continue;
      const src = new EncodedVideoPacketSource(codec);
      output.addVideoTrack(src);
      copies.push({ sink: new EncodedPacketSink(tr), add: (p, m) => src.add(p, m as never), meta: { decoderConfig: await tr.getDecoderConfig() } });
    } else if (tr.isAudioTrack()) {
      const codec = await tr.getCodec();
      if (!codec) continue;
      const src = new EncodedAudioPacketSource(codec);
      output.addAudioTrack(src);
      copies.push({ sink: new EncodedPacketSink(tr), add: (p, m) => src.add(p, m as never), meta: { decoderConfig: await tr.getDecoderConfig() } });
    }
  }

  const subSrcs = subs.map((s) => {
    // "ass" -> styled S_TEXT/ASS (MKV only; mediabunny rejects it for containers that can't
    // hold it). The caller passes "vtt" when styling isn't wanted or supported.
    const src = new TextSubtitleSource(s.kind === "ass" ? "ass" : "webvtt");
    output.addSubtitleTrack(src, { languageCode: LANG2TO3[s.language], name: s.name || undefined });
    return { src, content: s.content };
  });

  await output.start();
  // Add ALL subtitle cues up front (before streaming the A/V). Subtitles are sparse and small,
  // but the muxer can't flush a cluster until it knows there are no earlier subtitle cues still
  // to come; if we add them last it holds every A/V cluster until the end (buffering the whole
  // multi-GB output -> "Array buffer allocation failed"). Known up front, clusters flush freely.
  for (const ss of subSrcs) await ss.src.add(ss.content);
  // Feed A/V packets INTERLEAVED by timestamp across tracks. Copying one whole track before the
  // next forces the muxer to buffer every packet until the other tracks catch up. Always adding
  // the track whose next packet is earliest lets the muxer flush clusters as it goes, low memory.
  const heads: (EncodedPacket | null)[] = await Promise.all(copies.map((c) => c.sink.getFirstPacket()));
  const started = copies.map(() => false);
  for (;;) {
    let best = -1;
    for (let i = 0; i < copies.length; i++) {
      if (heads[i] && (best < 0 || (heads[i] as EncodedPacket).timestamp < (heads[best] as EncodedPacket).timestamp)) best = i;
    }
    if (best < 0) break;
    const p = heads[best] as EncodedPacket;
    await copies[best].add(p, started[best] ? undefined : copies[best].meta);
    started[best] = true;
    heads[best] = await copies[best].sink.getNextPacket(p);
  }
  await output.finalize();
}
