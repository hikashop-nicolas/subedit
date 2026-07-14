// Whisper transcription worker. Loads transformers.js off the main thread, downloads and
// caches the model (browser Cache Storage), and runs speech-to-text with word timestamps.
// Communicates with whisper.ts via structured messages (see WorkerIn / WorkerOut there).
import { pipeline, env } from "@huggingface/transformers";
import { post, onMessage, hasWebGpu, downloadProgress } from "./worker-common";

// Always fetch models from the Hugging Face hub and let the browser cache them.
env.allowLocalModels = false;

type DtypeSpec = string | Record<string, string>;
interface RunMsg {
  type: "run";
  audio: Float32Array;
  model: string;
  language?: string;
  device?: "webgpu" | "wasm";
  dtype?: { webgpu: DtypeSpec; wasm: DtypeSpec };
  timestamps?: "word" | "sentence";
  task?: "transcribe" | "translate";
}

type Transcriber = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text?: string; chunks?: { text: string; timestamp: [number | null, number | null] }[] }>;
let cached: { key: string; fn: Transcriber } | null = null;

async function getTranscriber(model: string, device: "webgpu" | "wasm", dtypeSpec?: { webgpu: DtypeSpec; wasm: DtypeSpec }): Promise<Transcriber> {
  const key = `${model}@${device}`;
  if (cached && cached.key === key) return cached.fn;
  const fallback = device === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8";
  const dtype = dtypeSpec ? dtypeSpec[device] : fallback;
  const options = { device, dtype, progress_callback: downloadProgress() };
  const fn = (await pipeline("automatic-speech-recognition", model, options as never)) as unknown as Transcriber;
  cached = { key, fn };
  return fn;
}

onMessage(async (e: MessageEvent) => {
  const msg = e.data as RunMsg;
  if (msg.type !== "run") return;
  try {
    let device: "webgpu" | "wasm" = msg.device ?? ((await hasWebGpu()) ? "webgpu" : "wasm");
    let transcribe: Transcriber;
    try {
      transcribe = await getTranscriber(msg.model, device, msg.dtype);
    } catch (gpuErr) {
      if (device !== "webgpu") throw gpuErr;
      device = "wasm";
      transcribe = await getTranscriber(msg.model, device, msg.dtype);
    }
    post({ type: "device", device });
    const opts = {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: msg.timestamps === "sentence" ? true : "word",
      language: msg.language || null,
      task: msg.task ?? "transcribe",
      // Whisper loops on non-speech (laughter, music): it repeats a token forever ("はっはっ…").
      // Forbidding any 5-gram from repeating breaks the loop while leaving normal speech alone.
      no_repeat_ngram_size: 5,
    };
    let out;
    try {
      out = await transcribe(msg.audio, opts);
    } catch (runErr) {
      // WebGPU can drop the device mid-run (context reset / device loss). A loss is often
      // transient, so rebuild the GPU pipeline and retry once (transcription is one long call,
      // so a redo is costly - one GPU retry, then finish on CPU rather than fail).
      if (device !== "webgpu") throw runErr;
      try {
        await new Promise((r) => setTimeout(r, 800));
        cached = null;
        transcribe = await getTranscriber(msg.model, "webgpu", msg.dtype);
        out = await transcribe(msg.audio, opts);
      } catch {
        device = "wasm";
        cached = null;
        transcribe = await getTranscriber(msg.model, device, msg.dtype);
        post({ type: "device", device });
        out = await transcribe(msg.audio, opts);
      }
    }
    const chunks: { text: string; timestamp: [number | null, number | null] }[] = out?.chunks ?? [];
    const words = chunks
      .filter((c) => c.timestamp?.[0] != null && c.timestamp?.[1] != null)
      .map((c) => ({ text: c.text, startMs: Math.round((c.timestamp[0] as number) * 1000), endMs: Math.round((c.timestamp[1] as number) * 1000) }));
    post({ type: "done", words, text: typeof out?.text === "string" ? out.text : words.map((w) => w.text).join("") });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
});
