// Main-thread driver for the Whisper worker. Spawns the worker, streams progress, and
// resolves with word timestamps. Cancelling terminates the worker (transformers.js has no
// mid-inference abort), which is enough for our flow.
import { whisperModel, type WordTs, type TranscribeProgress, type DtypeSpec } from "./backend";

export interface WhisperResult {
  words: WordTs[];
  text: string;
  device: "webgpu" | "wasm";
}

export interface WhisperRun {
  cancel(): void;
  done: Promise<WhisperResult>;
}

export interface WhisperOptions {
  model: string;
  language?: string; // omit for auto-detect
  device?: "webgpu" | "wasm"; // omit to auto-pick (WebGPU if available)
  dtype?: { webgpu: DtypeSpec; wasm: DtypeSpec }; // omit to use the model's recommended quantization
  timestamps?: "word" | "sentence"; // omit to use the model's default
}

// Kick off a transcription. `audio` must be 16 kHz mono PCM; it is transferred to the
// worker (do not reuse it afterwards).
export function runWhisper(audio: Float32Array, opts: WhisperOptions, onProgress?: (p: TranscribeProgress) => void): WhisperRun {
  const worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  let device: "webgpu" | "wasm" = "wasm";

  const done = new Promise<WhisperResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      switch (m.type) {
        case "progress":
          onProgress?.({ stage: "download", ratio: m.ratio, file: m.file });
          break;
        case "device":
          device = m.device;
          onProgress?.({ stage: "transcribe", ratio: 0 });
          break;
        case "done":
          resolve({ words: m.words, text: m.text, device });
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

  const info = whisperModel(opts.model);
  worker.postMessage(
    {
      type: "run",
      audio,
      model: opts.model,
      language: opts.language,
      device: opts.device,
      dtype: opts.dtype ?? info?.dtype,
      timestamps: opts.timestamps ?? info?.timestamps ?? "word",
    },
    [audio.buffer],
  );

  return {
    cancel: () => worker.terminate(),
    done,
  };
}
