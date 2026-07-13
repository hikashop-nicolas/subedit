// The "Auto-transcribe" dialog: pick a model + language, run Whisper on the loaded (or a
// chosen) media file, and hand the resulting cues back to the editor. Keeps the heavy
// transcribe modules (which pull in transformers.js) behind this lazily-imported file.
import { WHISPER_MODELS, DEFAULT_WHISPER_MODEL, TRANSLATE_MODELS, DEFAULT_TRANSLATE_MODEL, TRANSLATE_LANGS } from "./backend";
import { runWhisper, type WhisperRun } from "./whisper";
import { decodeToMono16k } from "./audio";
import { segmentToCues, type SegCue } from "./segment";
import { t } from "../i18n";

export interface TranscribeHost {
  mediaBytes(): Uint8Array | null; // the already-loaded preview media, if any
  hasCues(): boolean;
  onResult(cues: SegCue[], mode: "append" | "replace"): void;
}

// A subset of Whisper's languages; "" means auto-detect (all ~99 still work).
const LANGS: [string, string][] = [
  ["", t("asrAuto")],
  ["en", "English"],
  ["fr", "Français"],
  ["ja", "日本語"],
  ["es", "Español"],
  ["de", "Deutsch"],
  ["it", "Italiano"],
  ["pt", "Português"],
  ["nl", "Nederlands"],
  ["ru", "Русский"],
  ["zh", "中文"],
  ["ko", "한국어"],
  ["ar", "العربية"],
];

let cssInjected = false;
function injectCss(): void {
  if (cssInjected) return;
  cssInjected = true;
  const s = document.createElement("style");
  s.textContent = `
.se-asr-back{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;}
.se-asr{background:var(--se-bg,#1c1d21);color:var(--se-fg,#e6e7ea);border:1px solid var(--se-border,#33353b);border-radius:10px;
  width:min(460px,94vw);display:flex;flex-direction:column;font:13px system-ui,sans-serif;}
.se-asr-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--se-border,#33353b);}
.se-asr-head h3{margin:0;font-size:14px;flex:1 1 auto;}
.se-asr-body{padding:14px;display:flex;flex-direction:column;gap:12px;}
.se-asr-intro{color:var(--se-muted,#9aa0aa);font-size:12px;line-height:1.4;}
.se-asr-body label{display:flex;flex-direction:column;gap:4px;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:var(--se-muted,#9aa0aa);}
.se-asr-body select,.se-asr-body input[type=file]{font:inherit;padding:6px 8px;border:1px solid var(--se-border,#33353b);border-radius:6px;background:var(--se-head,#25272c);color:var(--se-fg,#e6e7ea);}
.se-asr-mode{display:flex;gap:14px;text-transform:none;flex-direction:row;color:var(--se-fg,#e6e7ea);}
.se-asr-mode label{flex-direction:row;align-items:center;gap:5px;text-transform:none;font-size:13px;color:var(--se-fg,#e6e7ea);}
.se-asr-status{display:none;flex-direction:column;gap:8px;}
.se-asr-status.on{display:flex;}
.se-asr-bar{height:6px;border-radius:3px;background:var(--se-head,#25272c);overflow:hidden;}
.se-asr-bar>div{height:100%;width:0;background:var(--se-accent,#2563eb);transition:width .2s;}
.se-asr-statline{font-size:12px;color:var(--se-muted,#9aa0aa);}
.se-asr-badge{font-size:11px;color:var(--se-muted,#9aa0aa);}
.se-asr-err{color:#e5484d;font-size:12px;}
.se-asr-foot{padding:10px 14px;border-top:1px solid var(--se-border,#33353b);display:flex;gap:8px;justify-content:flex-end;}
.se-asr button.act{font:inherit;padding:6px 13px;border:1px solid var(--se-border,#33353b);border-radius:6px;background:var(--se-head,#25272c);color:var(--se-fg,#e6e7ea);cursor:pointer;}
.se-asr button.act:hover{border-color:var(--se-accent,#2563eb);}
.se-asr button.act.primary{background:var(--se-accent,#2563eb);border-color:var(--se-accent,#2563eb);color:#fff;}
.se-asr button.act:disabled{opacity:.5;cursor:default;}
`;
  document.head.appendChild(s);
}

export function openTranscribeDialog(host: TranscribeHost): void {
  injectCss();
  let bytes: Uint8Array | null = host.mediaBytes();
  let run: WhisperRun | null = null;

  const back = document.createElement("div");
  back.className = "se-asr-back";
  const modal = document.createElement("div");
  modal.className = "se-asr";
  back.appendChild(modal);

  const head = document.createElement("div");
  head.className = "se-asr-head";
  const h3 = document.createElement("h3");
  h3.textContent = t("transcribeTitle");
  head.appendChild(h3);

  const body = document.createElement("div");
  body.className = "se-asr-body";
  const intro = document.createElement("p");
  intro.className = "se-asr-intro";
  intro.textContent = t("transcribeIntro");
  body.appendChild(intro);

  // Media picker (only shown when nothing is loaded yet).
  let fileLabel: HTMLLabelElement | null = null;
  if (!bytes) {
    fileLabel = document.createElement("label");
    fileLabel.textContent = t("asrChooseMedia");
    const file = document.createElement("input");
    file.type = "file";
    file.accept = "audio/*,video/*";
    file.addEventListener("change", async () => {
      const f = file.files?.[0];
      if (f) bytes = new Uint8Array(await f.arrayBuffer());
    });
    fileLabel.appendChild(file);
    body.appendChild(fileLabel);
  }

  const modelWrap = document.createElement("label");
  modelWrap.textContent = t("asrModel");
  const modelSel = document.createElement("select");
  for (const m of WHISPER_MODELS) {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = `${m.label} (~${m.sizeMb} MB)`;
    o.title = t(m.descKey);
    modelSel.appendChild(o);
  }
  modelSel.value = DEFAULT_WHISPER_MODEL;
  modelWrap.appendChild(modelSel);
  body.appendChild(modelWrap);
  // Live "why pick this" guidance for the selected model.
  const modelDesc = document.createElement("p");
  modelDesc.className = "se-asr-intro";
  const syncDesc = () => (modelDesc.textContent = t(WHISPER_MODELS.find((m) => m.id === modelSel.value)?.descKey ?? ""));
  modelSel.addEventListener("change", syncDesc);
  syncDesc();
  body.appendChild(modelDesc);

  const langWrap = document.createElement("label");
  langWrap.textContent = t("asrLanguage");
  const langSel = document.createElement("select");
  for (const [code, name] of LANGS) {
    const o = document.createElement("option");
    o.value = code;
    o.textContent = name;
    langSel.appendChild(o);
  }
  langWrap.appendChild(langSel);
  body.appendChild(langWrap);

  // Output: transcribe in the spoken language, or translate to English (e.g. JA to EN).
  const taskWrap = document.createElement("label");
  taskWrap.textContent = t("asrTask");
  const taskSel = document.createElement("select");
  for (const [val, label] of [
    ["transcribe", t("asrTaskTranscribe")],
    ["translate", t("asrTaskTranslate")],
  ] as [string, string][]) {
    const o = document.createElement("option");
    o.value = val;
    o.textContent = label;
    taskSel.appendChild(o);
  }
  taskWrap.appendChild(taskSel);
  body.appendChild(taskWrap);

  // Append / replace, only when the document already has cues.
  let mode: () => "append" | "replace" = () => "replace";
  if (host.hasCues()) {
    const modeWrap = document.createElement("div");
    modeWrap.className = "se-asr-mode";
    const mk = (val: "append" | "replace", label: string, checked: boolean) => {
      const l = document.createElement("label");
      const r = document.createElement("input");
      r.type = "radio";
      r.name = "se-asr-mode";
      r.value = val;
      r.checked = checked;
      l.append(r, document.createTextNode(label));
      return l;
    };
    modeWrap.append(mk("replace", t("asrReplace"), true), mk("append", t("asrAppend"), false));
    mode = () => (modeWrap.querySelector<HTMLInputElement>('input[value="append"]')?.checked ? "append" : "replace");
    body.appendChild(modeWrap);
  }

  // Progress area (hidden until Generate).
  const status = document.createElement("div");
  status.className = "se-asr-status";
  const bar = document.createElement("div");
  bar.className = "se-asr-bar";
  const barFill = document.createElement("div");
  bar.appendChild(barFill);
  const statLine = document.createElement("div");
  statLine.className = "se-asr-statline";
  const badge = document.createElement("div");
  badge.className = "se-asr-badge";
  status.append(bar, statLine, badge);
  body.appendChild(status);

  const err = document.createElement("div");
  err.className = "se-asr-err";
  body.appendChild(err);

  const foot = document.createElement("div");
  foot.className = "se-asr-foot";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "act";
  cancelBtn.textContent = t("close");
  const startBtn = document.createElement("button");
  startBtn.className = "act primary";
  startBtn.textContent = t("asrStart");
  foot.append(cancelBtn, startBtn);

  modal.append(head, body, foot);
  document.body.appendChild(back);

  const setBar = (ratio: number) => (barFill.style.width = `${Math.round(ratio * 100)}%`);
  const close = () => {
    run?.cancel();
    back.remove();
  };
  cancelBtn.addEventListener("click", close);
  back.addEventListener("click", (e) => {
    if (e.target === back) close();
  });

  startBtn.addEventListener("click", async () => {
    err.textContent = "";
    if (!bytes) {
      err.textContent = t("asrNeedMedia");
      return;
    }
    startBtn.disabled = true;
    modelSel.disabled = langSel.disabled = true;
    status.classList.add("on");
    try {
      statLine.textContent = t("asrDecoding");
      setBar(0);
      let audio: Float32Array;
      try {
        audio = await decodeToMono16k(bytes.slice().buffer);
      } catch {
        throw new Error(t("asrDecodeError"));
      }
      run = runWhisper(audio, { model: modelSel.value, language: langSel.value || undefined, task: taskSel.value as "transcribe" | "translate" }, (p) => {
        if (p.stage === "download") {
          statLine.textContent = `${t("asrDownloading")} ${Math.round(p.ratio * 100)}%`;
          setBar(p.ratio);
        } else {
          statLine.textContent = t("asrTranscribing");
          setBar(1);
        }
      });
      const result = await run.done;
      badge.textContent = result.device === "webgpu" ? t("asrUsingGpu") : t("asrUsingCpu");
      const cues = segmentToCues(result.words);
      host.onResult(cues, mode());
      back.remove();
    } catch (e) {
      err.textContent = `${t("asrError")}: ${e instanceof Error ? e.message : String(e)}`;
      status.classList.remove("on");
      startBtn.disabled = false;
      modelSel.disabled = langSel.disabled = false;
    }
  });
}

// The "Translate track" dialog: pick a source + target language and a translation model,
// run it over the active track's cue texts, and hand the translations back to the editor.
export interface TranslateHost {
  cueTexts(): string[]; // the source track's per-cue visible text
  sourceLanguage(): string; // "" if unknown
  // Kick off the translation as a background job. The dialog closes immediately; progress and
  // pause/stop controls live on the new track.
  onStart(opts: { model: string; srcLang: string; tgtLang: string }, targetCode: string, targetLabel: string): void;
}

export function openTranslateDialog(host: TranslateHost): void {
  injectCss();

  const back = document.createElement("div");
  back.className = "se-asr-back";
  const modal = document.createElement("div");
  modal.className = "se-asr";
  back.appendChild(modal);

  const head = document.createElement("div");
  head.className = "se-asr-head";
  const h3 = document.createElement("h3");
  h3.textContent = t("translateTitle");
  head.appendChild(h3);

  const body = document.createElement("div");
  body.className = "se-asr-body";
  const intro = document.createElement("p");
  intro.className = "se-asr-intro";
  intro.textContent = t("translateIntro");
  body.appendChild(intro);

  const langSelect = (label: string, def: string): { wrap: HTMLElement; sel: HTMLSelectElement } => {
    const wrap = document.createElement("label");
    wrap.textContent = label;
    const sel = document.createElement("select");
    for (const l of TRANSLATE_LANGS) {
      const o = document.createElement("option");
      o.value = l.code;
      o.textContent = l.label;
      sel.appendChild(o);
    }
    sel.value = def;
    wrap.appendChild(sel);
    return { wrap, sel };
  };

  const src = langSelect(t("sourceLang"), TRANSLATE_LANGS.some((l) => l.code === host.sourceLanguage()) ? host.sourceLanguage() : "ja");
  const tgt = langSelect(t("targetLang"), "en");
  body.append(src.wrap, tgt.wrap);

  const modelWrap = document.createElement("label");
  modelWrap.textContent = t("mtModel");
  const modelSel = document.createElement("select");
  for (const m of TRANSLATE_MODELS) {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = `${m.label} (~${m.sizeMb} MB)`;
    o.title = t(m.descKey);
    modelSel.appendChild(o);
  }
  modelSel.value = DEFAULT_TRANSLATE_MODEL;
  modelWrap.appendChild(modelSel);
  body.appendChild(modelWrap);
  const modelDesc = document.createElement("p");
  modelDesc.className = "se-asr-intro";
  const syncDesc = () => (modelDesc.textContent = t(TRANSLATE_MODELS.find((m) => m.id === modelSel.value)?.descKey ?? ""));
  modelSel.addEventListener("change", syncDesc);
  syncDesc();
  body.appendChild(modelDesc);

  const err = document.createElement("div");
  err.className = "se-asr-err";
  body.appendChild(err);

  const foot = document.createElement("div");
  foot.className = "se-asr-foot";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "act";
  cancelBtn.textContent = t("close");
  const startBtn = document.createElement("button");
  startBtn.className = "act primary";
  startBtn.textContent = t("translateStart");
  foot.append(cancelBtn, startBtn);

  modal.append(head, body, foot);
  document.body.appendChild(back);

  const close = () => back.remove();
  cancelBtn.addEventListener("click", close);
  back.addEventListener("click", (e) => {
    if (e.target === back) close();
  });

  startBtn.addEventListener("click", () => {
    err.textContent = "";
    if (src.sel.value === tgt.sel.value) {
      err.textContent = t("translateSameLang");
      return;
    }
    if (!host.cueTexts().length) {
      err.textContent = t("translateNoCues");
      return;
    }
    const label = TRANSLATE_LANGS.find((l) => l.code === tgt.sel.value)?.label ?? tgt.sel.value;
    // Hand off to the editor: it creates the track and runs the job in the background. The
    // dialog's work is done, so close it.
    host.onStart({ model: modelSel.value, srcLang: src.sel.value, tgtLang: tgt.sel.value }, tgt.sel.value, label);
    back.remove();
  });
}
