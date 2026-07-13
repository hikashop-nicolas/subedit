// Main-thread driver for the translation worker. Maps the common language codes to the
// chosen model's scheme (ISO for m2m100, FLORES for NLLB), spawns the worker, streams
// per-batch results and progress, and resolves when the run finishes. The run can be paused,
// resumed and stopped so the editor can drive it as a live background job.
import { translateModel, mtLangCode, type TranscribeProgress } from "./backend";

export interface TranslateRun {
  cancel(): void; // terminate immediately (drops the worker)
  pause(): void;
  resume(): void;
  done: Promise<{ stopped: boolean }>;
}

export interface TranslateOptions {
  model: string;
  srcLang: string; // common code, e.g. "ja"
  tgtLang: string; // common code, e.g. "fr"
  device?: "webgpu" | "wasm";
}

export interface TranslateCallbacks {
  onProgress?: (p: TranscribeProgress) => void;
  // Called for each translated batch as it lands: texts[k] is the translation of input
  // (start + k), so the caller can fill results live.
  onPartial?: (start: number, texts: string[]) => void;
  // Which compute backend the run settled on: "webgpu" (GPU, fast) or "wasm" (CPU).
  onDevice?: (device: "webgpu" | "wasm") => void;
}

export function runTranslate(texts: string[], opts: TranslateOptions, cb: TranslateCallbacks = {}): TranslateRun {
  const info = translateModel(opts.model);
  const scheme = info?.scheme ?? "iso";
  const worker = new Worker(new URL("./translate.worker.ts", import.meta.url), { type: "module" });

  const done = new Promise<{ stopped: boolean }>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      switch (m.type) {
        case "progress":
          cb.onProgress?.({ stage: m.stage, ratio: m.ratio, file: m.file });
          break;
        case "partial":
          cb.onPartial?.(m.start, m.texts);
          break;
        case "device":
          cb.onDevice?.(m.device);
          break;
        case "done":
          resolve({ stopped: !!m.stopped });
          worker.terminate();
          break;
        case "error":
          reject(new Error(m.message));
          worker.terminate();
          break;
      }
    };
    worker.onerror = (e) => {
      reject(new Error(e.message || "worker error"));
      worker.terminate();
    };
  });

  worker.postMessage({
    type: "run",
    texts,
    model: opts.model,
    srcLang: mtLangCode(scheme, opts.srcLang),
    tgtLang: mtLangCode(scheme, opts.tgtLang),
    device: opts.device,
    dtype: info?.dtype,
  });

  return {
    cancel: () => worker.terminate(),
    pause: () => worker.postMessage({ type: "pause" }),
    resume: () => worker.postMessage({ type: "resume" }),
    done,
  };
}
