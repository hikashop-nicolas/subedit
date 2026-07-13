// Shared helpers for the transformers.js workers (whisper + translate). These modules are
// only ever imported into a Worker, so `self` here is the importing worker's global scope.

type ProgressEvent = { status?: string; progress?: number; file?: string; loaded?: number; total?: number };

const ctx = self as unknown as { postMessage(m: unknown): void; onmessage: ((e: MessageEvent) => void) | null };

export const post = (message: unknown): void => ctx.postMessage(message);
export const onMessage = (handler: (e: MessageEvent) => void): void => {
  ctx.onmessage = handler;
};

// True if WebGPU is usable in this worker.
export const hasWebGpu = async (): Promise<boolean> => {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
};

// A transformers.js progress_callback that aggregates per-file download progress by bytes and
// posts one smooth {stage:"download", ratio} to the main thread, instead of each model file
// (encoder / decoder / tokenizer) jumping the bar back to 0.
export const downloadProgress = (): ((p: ProgressEvent) => void) => {
  const dl = new Map<string, { loaded: number; total: number }>();
  return (p) => {
    if (p.status !== "progress" || !p.file) return;
    if (typeof p.loaded === "number" && typeof p.total === "number" && p.total > 0) {
      dl.set(p.file, { loaded: p.loaded, total: p.total });
      let loaded = 0;
      let total = 0;
      for (const v of dl.values()) {
        loaded += v.loaded;
        total += v.total;
      }
      post({ type: "progress", stage: "download", ratio: total ? loaded / total : 0 });
    } else if (typeof p.progress === "number") {
      post({ type: "progress", stage: "download", ratio: p.progress / 100 });
    }
  };
};
