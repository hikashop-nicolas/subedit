// Mux subtitle tracks back into the media container. Stream-copies the input's video and
// audio packets (no re-encode) via mediabunny and writes our subtitle tracks alongside.
// v1 writes WebVTT subtitle tracks (plain text); styled ASS-in-MKV waits on the mediabunny
// S_TEXT/ASS fork, and MP4 subtitle output waits on the fork's WebVTT-assert fix.
import {
  Input,
  Output,
  BlobSource,
  BufferTarget,
  ALL_FORMATS,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  TextSubtitleSource,
  MkvOutputFormat,
  Mp4OutputFormat,
  type OutputFormat,
  type EncodedPacket,
} from "mediabunny";

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

export async function muxIntoContainer(mediaBytes: Uint8Array, subs: MuxSubtitle[], container: MuxContainer): Promise<Uint8Array> {
  const input = new Input({ source: new BlobSource(new Blob([mediaBytes.slice()])), formats: ALL_FORMATS });
  const format: OutputFormat = container === "mp4" ? new Mp4OutputFormat() : new MkvOutputFormat();
  const output = new Output({ format, target: new BufferTarget() });

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
  return new Uint8Array((output.target as BufferTarget).buffer as ArrayBuffer);
}
