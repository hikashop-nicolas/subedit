// Text-translation worker: runs a translation model (m2m100 / NLLB) off the main thread via
// transformers.js, downloading and caching it, and translates an array of subtitle texts
// from a source language to a target language. Talks to translate.ts via messages.
import { pipeline, env } from "@huggingface/transformers";
import { post, onMessage, hasWebGpu, downloadProgress } from "./worker-common";

env.allowLocalModels = false;

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

async function getTranslator(model: string, device: "webgpu" | "wasm", dtypeSpec?: { webgpu: DtypeSpec; wasm: DtypeSpec }): Promise<Translator> {
  const key = `${model}@${device}`;
  if (cached && cached.key === key) return cached.fn;
  const options = { device, dtype: dtypeSpec ? dtypeSpec[device] : "q8", progress_callback: downloadProgress() };
  const fn = (await pipeline("translation", model, options as never)) as unknown as Translator;
  cached = { key, fn };
  return fn;
}

onMessage(async (e: MessageEvent) => {
  const msg = e.data as RunMsg;
  if (msg.type !== "run") return;
  try {
    const device: "webgpu" | "wasm" = msg.device ?? ((await hasWebGpu()) ? "webgpu" : "wasm");
    const translate = await getTranslator(msg.model, device, msg.dtype);
    post({ type: "device", device });
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
      post({ type: "progress", stage: "translate", ratio: Math.min(1, (i + batch.length) / msg.texts.length) });
    }
    post({ type: "done", texts: results });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
});
