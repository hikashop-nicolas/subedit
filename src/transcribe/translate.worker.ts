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
    let device: "webgpu" | "wasm" = run.device ?? ((await hasWebGpu()) ? "webgpu" : "wasm");
    let translate: Translator;
    try {
      translate = await getTranslator(run.model, device, run.dtype);
    } catch (gpuErr) {
      // If the GPU can't load the model (driver/dtype quirks), fall back to CPU instead of
      // failing the whole job.
      if (device !== "webgpu") throw gpuErr;
      device = "wasm";
      translate = await getTranslator(run.model, device, run.dtype);
    }
    post({ type: "device", device });
    // m2m100/NLLB reliably translate the sentence first, then FAIL to emit EOS and ramble
    // (repeating, drifting into other languages). The single most effective cure is a tight
    // per-line max_new_tokens cap: a good translation runs ~1x the input length, so a cap
    // sized to the input keeps the real translation and cuts the ramble. That means going
    // one line at a time (the cap must match each line), which on CPU is no slower than beam
    // search over a batch. no_repeat_ngram_size guards short verbatim loops within the cap.
    const tokenizerOf = (fn: Translator) => (fn as unknown as { tokenizer?: (t: string) => { input_ids?: { size?: number; dims?: number[] } } }).tokenizer;
    let tokenizer = tokenizerOf(translate);
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
    // WebGPU can drop the device mid-run on long jobs (context reset / device loss:
    // "a valid external Instance reference no longer exists"). A loss is often transient, so
    // rebuild the GPU pipeline and retry the same line a few times (with a short backoff to let
    // the driver recover) before giving up and finishing on CPU. Losing the remainder of the
    // job is the last resort, never the first.
    const MAX_GPU_RETRIES = 3;
    let gpuRetries = 0;
    for (let i = 0; i < run.texts.length; ) {
      await waitWhilePaused();
      if (stopped) break;
      try {
        const out = await translate([run.texts[i]], { src_lang: run.srcLang, tgt_lang: run.tgtLang, max_new_tokens: capFor(run.texts[i]), no_repeat_ngram_size: 3 });
        const arr = Array.isArray(out) ? out : [out];
        // Stream each line as it lands so the main thread can fill the track live.
        post({ type: "partial", start: i, texts: [arr[0].translation_text] });
        post({ type: "progress", stage: "translate", ratio: (i + 1) / run.texts.length });
        i += 1;
        gpuRetries = 0; // a clean line resets the consecutive-failure count
      } catch (runErr) {
        if (device !== "webgpu") throw runErr;
        if (gpuRetries < MAX_GPU_RETRIES) {
          gpuRetries += 1;
          try {
            await new Promise((r) => setTimeout(r, 800));
            cached = null;
            translate = await getTranslator(run.model, "webgpu", run.dtype);
            tokenizer = tokenizerOf(translate);
            continue; // retry the same line on the GPU
          } catch {
            /* GPU won't come back; fall through to CPU below */
          }
        }
        device = "wasm";
        cached = null;
        translate = await getTranslator(run.model, device, run.dtype);
        tokenizer = tokenizerOf(translate);
        post({ type: "device", device });
      }
    }
    post({ type: "done", stopped });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
});
