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

// Pause control: the run loop parks between batches while paused so the model stops pulling
// work; resume/stop wake it. Stop lets the loop end gracefully (already-translated batches
// were streamed as "partial"), so no work in flight is lost.
let paused = false;
let stopped = false;
let wake: (() => void) | null = null;
const waitWhilePaused = async (): Promise<void> => {
  while (paused && !stopped) await new Promise<void>((r) => (wake = r));
  wake = null;
};

async function getTranslator(model: string, device: "webgpu" | "wasm", dtypeSpec?: { webgpu: DtypeSpec; wasm: DtypeSpec }): Promise<Translator> {
  const key = `${model}@${device}`;
  if (cached && cached.key === key) return cached.fn;
  const options = { device, dtype: dtypeSpec ? dtypeSpec[device] : "q8", progress_callback: downloadProgress() };
  const fn = (await pipeline("translation", model, options as never)) as unknown as Translator;
  cached = { key, fn };
  return fn;
}

onMessage(async (e: MessageEvent) => {
  const msg = e.data as { type: "run" | "pause" | "resume" | "stop" };
  if (msg.type === "pause") {
    paused = true;
    return;
  }
  if (msg.type === "resume") {
    paused = false;
    wake?.();
    return;
  }
  if (msg.type === "stop") {
    stopped = true;
    paused = false;
    wake?.();
    return;
  }
  if (msg.type !== "run") return;
  const run = e.data as RunMsg;
  try {
    const device: "webgpu" | "wasm" = run.device ?? ((await hasWebGpu()) ? "webgpu" : "wasm");
    const translate = await getTranslator(run.model, device, run.dtype);
    post({ type: "device", device });
    // m2m100/NLLB reliably translate the sentence first, then FAIL to emit EOS and ramble
    // (repeating, drifting into other languages). The single most effective cure is a tight
    // per-line max_new_tokens cap: a good translation runs ~1x the input length, so a cap
    // sized to the input keeps the real translation and cuts the ramble. That means going
    // one line at a time (the cap must match each line), which on CPU is no slower than beam
    // search over a batch. no_repeat_ngram_size guards short verbatim loops within the cap.
    const tokenizer = (translate as unknown as { tokenizer?: (t: string) => { input_ids?: { size?: number; dims?: number[] } } }).tokenizer;
    const capFor = (text: string): number => {
      let n = Math.ceil(text.length / 3) + 4; // char-based fallback
      try {
        const ids = tokenizer?.(text).input_ids;
        const toks = ids?.size ?? ids?.dims?.[ids.dims.length - 1];
        if (typeof toks === "number" && toks > 0) n = toks;
      } catch {
        /* keep the char estimate */
      }
      return Math.min(220, Math.max(24, Math.round(n * 1.6) + 8));
    };
    for (let i = 0; i < run.texts.length; i += 1) {
      await waitWhilePaused();
      if (stopped) break;
      const out = await translate([run.texts[i]], { src_lang: run.srcLang, tgt_lang: run.tgtLang, max_new_tokens: capFor(run.texts[i]), no_repeat_ngram_size: 3 });
      const arr = Array.isArray(out) ? out : [out];
      // Stream each line as it lands so the main thread can fill the track live.
      post({ type: "partial", start: i, texts: [arr[0].translation_text] });
      post({ type: "progress", stage: "translate", ratio: (i + 1) / run.texts.length });
    }
    post({ type: "done", stopped });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
});
