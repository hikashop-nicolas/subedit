// Shared helpers for the transformers.js workers (whisper + translate). These modules are
// only ever imported into a Worker, so `self` here is the importing worker's global scope.

type ProgressEvent = { status?: string; name?: string; progress?: number; file?: string; loaded?: number; total?: number };

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

// A transformers.js progress_callback that posts one {stage:"download", ratio} to the main
// thread. Each model file (config / tokenizer / encoder / decoder weights) is registered on
// its "initiate" event and weighted EQUALLY, so the bar rises monotonically: a tiny config
// finishing first can't spike it to 100% before the big weight files even report their size
// (the byte-weighted approach did exactly that, hence the 0->100->0 jump).
export const downloadProgress = (): ((p: ProgressEvent) => void) => {
  const files = new Map<string, { loaded: number; total: number; done: boolean }>();
  const emit = (): void => {
    let sum = 0;
    for (const f of files.values()) sum += f.done ? 1 : f.total > 0 ? f.loaded / f.total : 0;
    post({ type: "progress", stage: "download", ratio: files.size ? sum / files.size : 0 });
  };
  return (p) => {
    if (!p.file) return;
    if (p.status === "initiate") {
      if (!files.has(p.file)) files.set(p.file, { loaded: 0, total: 0, done: false });
    } else if (p.status === "progress") {
      const f = files.get(p.file) ?? { loaded: 0, total: 0, done: false };
      if (typeof p.loaded === "number") f.loaded = p.loaded;
      if (typeof p.total === "number") f.total = p.total;
      files.set(p.file, f);
    } else if (p.status === "done") {
      const f = files.get(p.file);
      if (f) {
        f.done = true;
        f.loaded = f.total || f.loaded;
      } else {
        files.set(p.file, { loaded: 1, total: 1, done: true });
      }
    } else {
      return;
    }
    emit();
  };
};
