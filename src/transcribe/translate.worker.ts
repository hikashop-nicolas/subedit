// Text-translation worker: runs a translation model (m2m100 / NLLB) off the main thread via
// transformers.js, downloading and caching it, and translates an array of subtitle texts
// from a source language to a target language. Talks to translate.ts via messages.
import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;

const ctx = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

type DtypeSpec = string | Record<string, string>;
interface RunMsg {
  type: "run";
  texts: string[];
  model: string;
  srcLang: string; // already mapped to the model's code scheme
  tgtLang: string;
  device?: "webgpu" | "wasm";
  dtype?: { webgpu: DtypeSpec; wasm: DtypeSpec };
}

type Translator = (texts: string[], opts: Record<string, unknown>) => Promise<{ translation_text: string }[] | { translation_text: string }>;
let cached: { key: string; fn: Translator } | null = null;

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function getTranslator(model: string, device: "webgpu" | "wasm", dtypeSpec?: { webgpu: DtypeSpec; wasm: DtypeSpec }): Promise<Translator> {
  const key = `${model}@${device}`;
  if (cached && cached.key === key) return cached.fn;
  const options = {
    device,
    dtype: dtypeSpec ? dtypeSpec[device] : "q8",
    progress_callback: (p: { status?: string; progress?: number; file?: string }) => {
      if (p.status === "progress" && typeof p.progress === "number") ctx.postMessage({ type: "progress", stage: "download", ratio: p.progress / 100, file: p.file });
    },
  };
  const fn = (await pipeline("translation", model, options as never)) as unknown as Translator;
  cached = { key, fn };
  return fn;
}

ctx.onmessage = async (e: MessageEvent) => {
  const msg = e.data as RunMsg;
  if (msg.type !== "run") return;
  try {
    const device: "webgpu" | "wasm" = msg.device ?? ((await hasWebGpu()) ? "webgpu" : "wasm");
    const translate = await getTranslator(msg.model, device, msg.dtype);
    ctx.postMessage({ type: "device", device });
    const results: string[] = [];
    const BATCH = 12;
    for (let i = 0; i < msg.texts.length; i += BATCH) {
      const batch = msg.texts.slice(i, i + BATCH);
      // repetition_penalty curbs m2m100's habit of re-translating short inputs into other
      // languages (e.g. "Bonjour le monde Hej"); no_repeat_ngram_size guards verbatim loops.
      // Both are harmless on normal-length lines.
      const out = await translate(batch, { src_lang: msg.srcLang, tgt_lang: msg.tgtLang, repetition_penalty: 1.3, no_repeat_ngram_size: 3 });
      const arr = Array.isArray(out) ? out : [out];
      results.push(...arr.map((o) => o.translation_text));
      ctx.postMessage({ type: "progress", stage: "translate", ratio: Math.min(1, (i + batch.length) / msg.texts.length) });
    }
    ctx.postMessage({ type: "done", texts: results });
  } catch (err) {
    ctx.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
