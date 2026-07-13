// Main-thread driver for the translation worker. Maps the common language codes to the
// chosen model's scheme (ISO for m2m100, FLORES for NLLB), spawns the worker, streams
// progress, and resolves with the translated texts. Cancel terminates the worker.
import { translateModel, mtLangCode, type TranscribeProgress } from "./backend";

export interface TranslateRun {
  cancel(): void;
  done: Promise<string[]>;
}

export interface TranslateOptions {
  model: string;
  srcLang: string; // common code, e.g. "ja"
  tgtLang: string; // common code, e.g. "fr"
  device?: "webgpu" | "wasm";
}

export function runTranslate(texts: string[], opts: TranslateOptions, onProgress?: (p: TranscribeProgress) => void): TranslateRun {
  const info = translateModel(opts.model);
  const scheme = info?.scheme ?? "iso";
  const worker = new Worker(new URL("./translate.worker.ts", import.meta.url), { type: "module" });

  const done = new Promise<string[]>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      switch (m.type) {
        case "progress":
          onProgress?.({ stage: m.stage, ratio: m.ratio, file: m.file });
          break;
        case "device":
          onProgress?.({ stage: "transcribe", ratio: 0 });
          break;
        case "done":
          resolve(m.texts);
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

  return { cancel: () => worker.terminate(), done };
}
