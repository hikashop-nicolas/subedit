// Shared types for automatic transcription. The engine (Whisper, in whisper.ts) turns an
// audio buffer into timestamped tokens; the segmentation module (segment.ts) turns those
// into readable cues. The interface stays engine-agnostic so another backend could be
// dropped in later, but Whisper is the only implementation.

export interface WordTs {
  text: string;
  startMs: number;
  endMs: number;
}

// A transformers.js dtype spec: one dtype for all sub-models, or per sub-model.
export type DtypeSpec = string | Record<string, string>;

export interface WhisperModelInfo {
  id: string; // Hugging Face repo id
  label: string;
  sizeMb: number; // approximate download size at the chosen quantization
  descKey: string; // i18n key for a "why pick this" description shown in the dialog
  // Recommended quantization per compute backend (keeps big models downloadable).
  dtype: { webgpu: DtypeSpec; wasm: DtypeSpec };
  // "word" needs a cross-attention (_timestamped) export; "sentence" works on any model.
  timestamps: "word" | "sentence";
}

export type TranscribeProgress =
  | { stage: "download"; ratio: number; file?: string }
  | { stage: "transcribe"; ratio: number };

// Word-timestamped, multilingual Whisper checkpoints (ONNX, browser-quantized). The
// _timestamped exports emit cross-attentions so return_timestamps: "word" works.
const WORD_DTYPE = { webgpu: { encoder_model: "fp32", decoder_model_merged: "q4" }, wasm: "q8" };

export const WHISPER_MODELS: WhisperModelInfo[] = [
  { id: "onnx-community/whisper-tiny_timestamped", label: "Tiny", sizeMb: 60, descKey: "modelDescTiny", dtype: WORD_DTYPE, timestamps: "word" },
  { id: "onnx-community/whisper-base_timestamped", label: "Base", sizeMb: 110, descKey: "modelDescBase", dtype: WORD_DTYPE, timestamps: "word" },
  { id: "onnx-community/whisper-small_timestamped", label: "Small", sizeMb: 260, descKey: "modelDescSmall", dtype: WORD_DTYPE, timestamps: "word" },
  {
    id: "onnx-community/kotoba-whisper-bilingual-v1.0-ONNX",
    label: "Kotoba bilingual (JA/EN)",
    sizeMb: 510,
    descKey: "modelDescKotoba",
    dtype: { webgpu: { encoder_model: "q4f16", decoder_model_merged: "q4f16" }, wasm: "q8" },
    timestamps: "sentence",
  },
];

export const DEFAULT_WHISPER_MODEL = "onnx-community/whisper-base_timestamped";

export function whisperModel(id: string): WhisperModelInfo | undefined {
  return WHISPER_MODELS.find((m) => m.id === id);
}

// --- text translation (for targets other than English) -------------------------------

export interface TranslateModelInfo {
  id: string;
  label: string;
  sizeMb: number;
  descKey: string;
  scheme: "iso" | "flores"; // which language-code scheme the model expects
  dtype: { webgpu: DtypeSpec; wasm: DtypeSpec };
}

export const TRANSLATE_MODELS: TranslateModelInfo[] = [
  { id: "Xenova/m2m100_418M", label: "M2M-100", sizeMb: 500, descKey: "mtDescM2m", scheme: "iso", dtype: { webgpu: "q8", wasm: "q8" } },
  { id: "Xenova/nllb-200-distilled-600M", label: "NLLB-200", sizeMb: 800, descKey: "mtDescNllb", scheme: "flores", dtype: { webgpu: "q8", wasm: "q8" } },
];

export const DEFAULT_TRANSLATE_MODEL = "Xenova/m2m100_418M";

export function translateModel(id: string): TranslateModelInfo | undefined {
  return TRANSLATE_MODELS.find((m) => m.id === id);
}

// The languages offered for source/target, with each model's code for them.
export const TRANSLATE_LANGS: { code: string; label: string; iso: string; flores: string }[] = [
  { code: "en", label: "English", iso: "en", flores: "eng_Latn" },
  { code: "fr", label: "Français", iso: "fr", flores: "fra_Latn" },
  { code: "ja", label: "日本語", iso: "ja", flores: "jpn_Jpan" },
  { code: "es", label: "Español", iso: "es", flores: "spa_Latn" },
  { code: "de", label: "Deutsch", iso: "de", flores: "deu_Latn" },
  { code: "it", label: "Italiano", iso: "it", flores: "ita_Latn" },
  { code: "pt", label: "Português", iso: "pt", flores: "por_Latn" },
  { code: "nl", label: "Nederlands", iso: "nl", flores: "nld_Latn" },
  { code: "ru", label: "Русский", iso: "ru", flores: "rus_Cyrl" },
  { code: "zh", label: "中文", iso: "zh", flores: "zho_Hans" },
  { code: "ko", label: "한국어", iso: "ko", flores: "kor_Hang" },
  { code: "ar", label: "العربية", iso: "ar", flores: "arb_Arab" },
];

// Map a common code (e.g. "fr") to what the chosen translation model expects.
export function mtLangCode(scheme: "iso" | "flores", common: string): string {
  const l = TRANSLATE_LANGS.find((x) => x.code === common);
  return l ? l[scheme] : common;
}
