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

// Buffer the whole output in memory and return it. Fine for typical files.
export async function muxIntoContainer(mediaBytes: Uint8Array, subs: MuxSubtitle[], container: MuxContainer): Promise<Uint8Array> {
  const target = new BufferTarget();
  await runMux(mediaBytes, subs, container, target);
  return new Uint8Array(target.buffer as ArrayBuffer);
}

// Stream the output straight to a file (showSaveFilePicker handle), so multi-GB saves never
// buffer the whole result in RAM. StreamTarget's chunks match FileSystemWritableFileStream.
export async function muxToFile(mediaBytes: Uint8Array, subs: MuxSubtitle[], container: MuxContainer, file: FileWritable): Promise<void> {
  const stream = new WritableStream<StreamTargetChunk>({
    write: (chunk) => file.write(chunk),
    close: () => file.close(),
    abort: (reason) => file.abort?.(reason) ?? Promise.resolve(),
  });
  await runMux(mediaBytes, subs, container, new StreamTarget(stream));
}

async function runMux(mediaBytes: Uint8Array, subs: MuxSubtitle[], container: MuxContainer, target: Target): Promise<void> {
  const input = new Input({ source: new BlobSource(new Blob([mediaBytes.slice()])), formats: ALL_FORMATS });
  const format: OutputFormat = container === "mp4" ? new Mp4OutputFormat() : new MkvOutputFormat();
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
  for (const c of copies) {
    let p = await c.sink.getFirstPacket();
    let first = true;
    while (p) {
      await c.add(p, first ? c.meta : undefined);
      first = false;
      p = await c.sink.getNextPacket(p);
    }
  }
  for (const ss of subSrcs) await ss.src.add(ss.content);
  await output.finalize();
}
