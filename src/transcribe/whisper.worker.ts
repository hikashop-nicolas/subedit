// Whisper transcription worker. Loads transformers.js off the main thread, downloads and
// caches the model (browser Cache Storage), and runs speech-to-text with word timestamps.
// Communicates with whisper.ts via structured messages (see WorkerIn / WorkerOut there).
import { pipeline, env } from "@huggingface/transformers";

// Always fetch models from the Hugging Face hub and let the browser cache them.
env.allowLocalModels = false;

// `self` is a DedicatedWorkerGlobalScope; type just the bits we use (the lib config uses
// the DOM lib, where these have different signatures, so we cast).
const ctx = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

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

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function getTranscriber(model: string, device: "webgpu" | "wasm", dtypeSpec?: { webgpu: DtypeSpec; wasm: DtypeSpec }): Promise<Transcriber> {
  const key = `${model}@${device}`;
  if (cached && cached.key === key) return cached.fn;
  const fallback = device === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8";
  const dtype = dtypeSpec ? dtypeSpec[device] : fallback;
  const options = {
    device,
    dtype,
    progress_callback: (p: { status?: string; progress?: number; file?: string }) => {
      if (p.status === "progress" && typeof p.progress === "number") {
        ctx.postMessage({ type: "progress", stage: "download", ratio: p.progress / 100, file: p.file });
      }
    },
  };
  const fn = (await pipeline("automatic-speech-recognition", model, options as never)) as unknown as Transcriber;
  cached = { key, fn };
  return fn;
}

ctx.onmessage = async (e: MessageEvent) => {
  const msg = e.data as RunMsg;
  if (msg.type !== "run") return;
  try {
    const device: "webgpu" | "wasm" = msg.device ?? ((await hasWebGpu()) ? "webgpu" : "wasm");
    const transcribe = await getTranscriber(msg.model, device, msg.dtype);
    ctx.postMessage({ type: "device", device });
    const out = await transcribe(msg.audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: msg.timestamps === "sentence" ? true : "word",
      language: msg.language || null,
      task: msg.task ?? "transcribe",
    });
    const chunks: { text: string; timestamp: [number | null, number | null] }[] = out?.chunks ?? [];
    const words = chunks
      .filter((c) => c.timestamp?.[0] != null && c.timestamp?.[1] != null)
      .map((c) => ({ text: c.text, startMs: Math.round((c.timestamp[0] as number) * 1000), endMs: Math.round((c.timestamp[1] as number) * 1000) }));
    ctx.postMessage({ type: "done", words, text: typeof out?.text === "string" ? out.text : words.map((w) => w.text).join("") });
  } catch (err) {
    ctx.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
