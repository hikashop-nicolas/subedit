// The subtitle editor UI and the createSubtitleEditor entry point.
//
// Layout: a toolbar on top; below it a row with the cue list + a detail editor on the
// left and a video/audio preview on the right. The cue list is virtualized so files
// with thousands of cues stay responsive. The preview is a plain <video> in this phase
// (double-click a cue to seek, current cue highlights); a later phase swaps in the
// mediaplay embed for full-format playback and live subtitle rendering.

import {
  type Cue,
  type SubtitleDoc,
  type SubtitleFormat,
  blankCue,
  cps,
  formatTimestamp,
  newCueId,
  parseTimestamp,
  sortCues,
} from "./cue";
import { parseSubtitles, serializeSubtitles, convertDoc } from "./subtitles";
import { setLocale, t } from "./i18n";
import { Timeline, extractPeaks } from "./waveform";
import { createMediaPlayer, type MediaPlayerHandle } from "mediaplay";

// decodeAudioData holds the whole decoded PCM in RAM, so only attempt waveform
// extraction on reasonably small files; larger media shows the timeline without peaks.
const MAX_DECODE_BYTES = 100 * 1024 * 1024;

export interface SubtitleInput {
  text: string;
  filename?: string;
}

export interface SubtitleEditorOptions {
  // Called after any edit that changes the document.
  onChange?: () => void;
  // Force a UI locale (else auto-detected from the browser).
  locale?: string;
  // Show the toolbar Save button (downloads the file). Hosts that own saving pass false.
  showSave?: boolean;
}

export interface SubtitleEditorHandle {
  getText(): string;
  getDoc(): SubtitleDoc;
  // Load a video/audio file into the preview pane programmatically (same as the
  // "Load video" button). Useful for a host that already has the media in hand.
  loadPreviewMedia(file: File): void;
  focus(): void;
  destroy(): void;
}

const ROW_H = 46; // px per cue row
const OVERSCAN = 6; // extra rows rendered above/below the viewport
const CPS_WARN = 21;
const CPS_BAD = 27;

// Inline stroke icons for the toolbar (16-unit viewBox, currentColor), same style as
// richdoc. Each button pairs one of these with a title/aria-label tooltip.
const svgIcon = (inner: string): string =>
  `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON = {
  add: svgIcon('<path d="M8 3.5v9M3.5 8h9"/>'),
  remove: svgIcon('<path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.4 8.5h6.2l.4-8.5"/>'),
  shift: svgIcon('<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2.2 1.3"/>'),
  overlaps: svgIcon('<rect x="2.5" y="3.5" width="7" height="4" rx="1"/><rect x="6.5" y="8.5" width="7" height="4" rx="1"/>'),
  save: svgIcon('<path d="M8 2.5v7.5M5 7.5l3 3 3-3M3.5 13h9"/>'),
};

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
.se-root{--se-bg:#fff;--se-fg:#1a1a1e;--se-muted:#667;--se-border:#e2e4ea;--se-sel:#dbeafe;--se-sel-fg:#0b1220;--se-head:#f6f7f9;--se-warn:#b45309;--se-bad:#b91c1c;--se-accent:#2563eb;
  display:flex;flex-direction:column;height:100%;min-height:0;font-family:system-ui,sans-serif;color:var(--se-fg);background:var(--se-bg);font-size:13px;}
.se-toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:6px 8px;border-bottom:1px solid var(--se-border);background:var(--se-head);}
.se-toolbar b{font-size:13px;margin-right:6px;}
.se-toolbar .se-sp{flex:1 1 auto;}
.se-btn{font:inherit;padding:4px 9px;border:1px solid var(--se-border);background:var(--se-bg);color:var(--se-fg);border-radius:6px;cursor:pointer;}
.se-btn:hover{border-color:var(--se-accent);}
.se-btn:disabled{opacity:.5;cursor:default;}
.se-iconbtn{display:inline-flex;align-items:center;justify-content:center;padding:5px 7px;color:var(--se-fg);}
.se-iconbtn:hover{color:var(--se-accent);}
.se-iconbtn svg{display:block;}
.se-count{color:var(--se-muted);font-size:12px;}
.se-body{flex:1 1 auto;display:flex;min-height:0;}
.se-left{flex:1 1 55%;display:flex;flex-direction:column;min-width:0;border-right:1px solid var(--se-border);}
.se-right{flex:1 1 45%;display:flex;flex-direction:column;min-width:0;background:#000;}
.se-listhead,.se-row{display:grid;grid-template-columns:44px 96px 96px 52px 44px 1fr;align-items:center;gap:6px;padding:0 8px;}
.se-listhead{height:28px;border-bottom:1px solid var(--se-border);color:var(--se-muted);font-size:11px;text-transform:uppercase;letter-spacing:.03em;background:var(--se-head);flex:0 0 auto;}
.se-scroll{flex:1 1 auto;overflow-y:auto;position:relative;}
.se-inner{position:relative;width:100%;}
.se-row{position:absolute;left:0;right:0;height:${ROW_H}px;border-bottom:1px solid var(--se-border);cursor:pointer;box-sizing:border-box;}
.se-row:hover{background:var(--se-head);}
.se-row.sel{background:var(--se-sel);color:var(--se-sel-fg);}
.se-row.playing{box-shadow:inset 3px 0 0 var(--se-accent);}
.se-cell{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.se-num{color:var(--se-muted);}
.se-time{font-variant-numeric:tabular-nums;font-size:12px;}
.se-cps.warn{color:var(--se-warn);}
.se-cps.bad{color:var(--se-bad);font-weight:600;}
.se-text{white-space:pre;overflow:hidden;text-overflow:ellipsis;}
.se-detail{flex:0 0 auto;border-top:1px solid var(--se-border);padding:8px;display:flex;flex-direction:column;gap:6px;background:var(--se-head);}
.se-times{display:flex;gap:8px;flex-wrap:wrap;}
.se-field{display:flex;flex-direction:column;gap:2px;font-size:11px;color:var(--se-muted);}
.se-field input{font:inherit;font-variant-numeric:tabular-nums;padding:3px 6px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);width:110px;}
.se-detail textarea{font:inherit;min-height:56px;resize:vertical;padding:6px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);}
.se-empty,.se-noprev{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;text-align:center;padding:24px;color:var(--se-muted);}
.se-noprev{color:#aab;}
.se-empty h3{margin:0;color:var(--se-fg);font-size:15px;}
.se-playerhost{flex:1 1 auto;min-height:0;width:100%;height:100%;}
.se-timeline-wrap{flex:0 0 auto;border-top:1px solid var(--se-border);background:var(--se-head);}
.se-timeline{touch-action:none;cursor:crosshair;}
@media (prefers-color-scheme: dark){
.se-root{--se-bg:#1c1d21;--se-fg:#e6e7ea;--se-muted:#9aa0aa;--se-border:#33353b;--se-sel:#1e3a5f;--se-sel-fg:#eaf2ff;--se-head:#25272c;--se-warn:#f59e0b;--se-bad:#f87171;--se-accent:#60a5fa;}
}
`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

class SubtitleEditor implements SubtitleEditorHandle {
  private root: HTMLDivElement;
  private doc: SubtitleDoc;
  private opts: SubtitleEditorOptions;
  private selectedId: string | null = null;
  private playingId: string | null = null;

  private scrollEl!: HTMLDivElement;
  private innerEl!: HTMLDivElement;
  private detailEl!: HTMLDivElement;
  private countEl!: HTMLSpanElement;
  private rightEl!: HTMLDivElement;
  private player: MediaPlayerHandle | null = null;
  private video: HTMLMediaElement | null = null;
  private timeline: Timeline | null = null;
  private rows = new Map<string, HTMLDivElement>();
  private rafPending = false;
  private subtitleTimer = 0;

  constructor(container: HTMLElement, input: SubtitleInput, opts: SubtitleEditorOptions) {
    this.opts = opts;
    if (opts.locale) setLocale(opts.locale);
    injectStyles();
    this.doc = parseSubtitles(input.text, input.filename);

    this.root = document.createElement("div");
    this.root.className = "se-root";
    this.root.tabIndex = 0;
    container.appendChild(this.root);

    this.buildToolbar();
    this.buildBody();
    this.renderList();
    this.renderDetail();
    if (this.doc.cues.length) this.select(this.doc.cues[0].id);

    this.root.addEventListener("keydown", this.onKeydown);
  }

  // --- structure -----------------------------------------------------------

  private buildToolbar(): void {
    const bar = el("div", "se-toolbar");
    bar.appendChild(el("b", "", t("appName")));

    bar.appendChild(this.iconButton(ICON.add, t("addCue"), () => this.addCue()));
    bar.appendChild(this.iconButton(ICON.remove, t("removeCue"), () => this.removeCue()));
    bar.appendChild(this.iconButton(ICON.shift, t("shiftTimes"), () => this.shiftTimes()));
    bar.appendChild(this.iconButton(ICON.overlaps, t("fixOverlaps"), () => this.fixOverlaps()));

    const fmt = document.createElement("select");
    fmt.className = "se-btn";
    for (const f of ["srt", "vtt", "ass"] as SubtitleFormat[]) {
      const o = document.createElement("option");
      o.value = f;
      o.textContent = f.toUpperCase();
      fmt.appendChild(o);
    }
    fmt.value = this.doc.format;
    fmt.title = t("format");
    fmt.addEventListener("change", () => this.setFormat(fmt.value as SubtitleFormat));
    bar.appendChild(fmt);

    const sp = el("span", "se-sp");
    bar.appendChild(sp);

    this.countEl = el("span", "se-count") as HTMLSpanElement;
    bar.appendChild(this.countEl);

    if (this.opts.showSave !== false) {
      bar.appendChild(this.iconButton(ICON.save, t("save"), () => this.save()));
    }
    this.root.appendChild(bar);
  }

  private buildBody(): void {
    const body = el("div", "se-body");
    const left = el("div", "se-left");

    const head = el("div", "se-listhead");
    for (const [cls, key] of [
      ["se-num", "colIndex"],
      ["", "colStart"],
      ["", "colEnd"],
      ["", "colDuration"],
      ["", "colCps"],
      ["", "colText"],
    ] as const) {
      head.appendChild(el("div", cls, t(key)));
    }
    left.appendChild(head);

    this.scrollEl = el("div", "se-scroll") as HTMLDivElement;
    this.innerEl = el("div", "se-inner") as HTMLDivElement;
    this.scrollEl.appendChild(this.innerEl);
    this.scrollEl.addEventListener("scroll", this.onScroll);
    left.appendChild(this.scrollEl);

    this.detailEl = el("div", "se-detail") as HTMLDivElement;
    left.appendChild(this.detailEl);

    this.rightEl = el("div", "se-right") as HTMLDivElement;
    this.renderPreviewPlaceholder();

    body.appendChild(left);
    body.appendChild(this.rightEl);
    this.root.appendChild(body);

    // Bottom timeline: cue blocks + waveform + playhead, spanning the full width.
    const strip = el("div", "se-timeline-wrap");
    this.root.appendChild(strip);
    this.timeline = new Timeline({
      getCues: () => this.doc.cues,
      getDuration: () => this.video?.duration ?? 0,
      getCurrentTime: () => this.video?.currentTime ?? 0,
      getSelectedId: () => this.selectedId,
      onSeek: (sec) => this.seekTo(sec * 1000),
      onSelectCue: (id) => this.select(id),
      onRetime: (id, startMs, endMs, commit) => this.retimeCue(id, startMs, endMs, commit),
    });
    this.timeline.mount(strip);
  }

  // Drag-retime from the timeline: update the cue live, commit (push + onChange) on release.
  private retimeCue(id: string, startMs: number, endMs: number, commit: boolean): void {
    const cue = this.doc.cues.find((c) => c.id === id);
    if (!cue) return;
    cue.startMs = startMs;
    cue.endMs = endMs;
    this.refreshRow(id);
    if (commit) {
      if (id === this.selectedId) this.renderDetail();
      this.markDirty();
    }
  }

  // --- cue list (virtualized) ----------------------------------------------

  private onScroll = (): void => {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.renderWindow();
    });
  };

  private renderList(): void {
    this.innerEl.style.height = `${this.doc.cues.length * ROW_H}px`;
    this.countEl.textContent = t("cueCount", { n: this.doc.cues.length });
    this.renderWindow();
    if (this.doc.cues.length === 0) this.renderEmptyList();
    this.timeline?.render();
  }

  private renderEmptyList(): void {
    this.rows.clear();
    this.innerEl.textContent = "";
    const empty = el("div", "se-empty");
    empty.style.position = "absolute";
    empty.style.inset = "0";
    empty.appendChild(el("div", "", t("noCues")));
    this.innerEl.appendChild(empty);
  }

  private renderWindow(): void {
    const cues = this.doc.cues;
    if (cues.length === 0) return;
    const scrollTop = this.scrollEl.scrollTop;
    const viewH = this.scrollEl.clientHeight || 400;
    const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
    const last = Math.min(cues.length - 1, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);

    const needed = new Set<string>();
    for (let i = first; i <= last; i += 1) {
      const cue = cues[i];
      needed.add(cue.id);
      let row = this.rows.get(cue.id);
      if (!row) {
        row = this.makeRow(cue);
        this.rows.set(cue.id, row);
        this.innerEl.appendChild(row);
      }
      this.fillRow(row, cue, i);
      row.style.top = `${i * ROW_H}px`;
    }
    // Recycle rows that scrolled out of the window.
    for (const [id, row] of this.rows) {
      if (!needed.has(id)) {
        row.remove();
        this.rows.delete(id);
      }
    }
  }

  private makeRow(cue: Cue): HTMLDivElement {
    const row = el("div", "se-row") as HTMLDivElement;
    row.dataset.id = cue.id;
    row.appendChild(el("div", "se-cell se-num"));
    row.appendChild(el("div", "se-cell se-time se-start"));
    row.appendChild(el("div", "se-cell se-time se-end"));
    row.appendChild(el("div", "se-cell se-time se-dur"));
    row.appendChild(el("div", "se-cell se-cps"));
    row.appendChild(el("div", "se-cell se-text"));
    row.addEventListener("click", () => this.select(cue.id));
    row.addEventListener("dblclick", () => this.seekTo(cue.startMs, true));
    return row;
  }

  private fillRow(row: HTMLDivElement, cue: Cue, index: number): void {
    const sep = this.doc.format === "srt" ? "," : ".";
    (row.children[0] as HTMLElement).textContent = String(index + 1);
    (row.children[1] as HTMLElement).textContent = formatTimestamp(cue.startMs, sep);
    (row.children[2] as HTMLElement).textContent = formatTimestamp(cue.endMs, sep);
    (row.children[3] as HTMLElement).textContent = ((cue.endMs - cue.startMs) / 1000).toFixed(1);
    const c = cps(cue);
    const cpsCell = row.children[4] as HTMLElement;
    cpsCell.textContent = c ? c.toFixed(0) : "";
    cpsCell.className = "se-cell se-cps" + (c > CPS_BAD ? " bad" : c > CPS_WARN ? " warn" : "");
    (row.children[5] as HTMLElement).textContent = cue.text.replace(/\n/g, " ⏎ ");
    row.classList.toggle("sel", cue.id === this.selectedId);
    row.classList.toggle("playing", cue.id === this.playingId);
  }

  private refreshRow(id: string): void {
    const row = this.rows.get(id);
    const index = this.doc.cues.findIndex((c) => c.id === id);
    if (row && index >= 0) this.fillRow(row, this.doc.cues[index], index);
  }

  // --- selection + detail editor -------------------------------------------

  private select(id: string): void {
    if (this.selectedId === id) return;
    const prev = this.selectedId;
    this.selectedId = id;
    if (prev) this.refreshRow(prev);
    this.refreshRow(id);
    this.scrollSelectedIntoView();
    this.renderDetail();
    this.timeline?.render();
  }

  private scrollSelectedIntoView(): void {
    const i = this.doc.cues.findIndex((c) => c.id === this.selectedId);
    if (i < 0) return;
    const top = i * ROW_H;
    const viewTop = this.scrollEl.scrollTop;
    const viewH = this.scrollEl.clientHeight;
    if (top < viewTop) this.scrollEl.scrollTop = top;
    else if (top + ROW_H > viewTop + viewH) this.scrollEl.scrollTop = top + ROW_H - viewH;
  }

  private renderDetail(): void {
    this.detailEl.textContent = "";
    const cue = this.selectedCue();
    if (!cue) {
      this.detailEl.appendChild(el("div", "se-count", t("selectCue")));
      return;
    }
    const sep = this.doc.format === "srt" ? "," : ".";
    const times = el("div", "se-times");
    times.appendChild(
      this.timeField(t("start"), formatTimestamp(cue.startMs, sep), (v) => {
        const ms = parseTimestamp(v);
        if (!Number.isNaN(ms)) this.updateCue(cue.id, { startMs: ms });
      }),
    );
    times.appendChild(
      this.timeField(t("end"), formatTimestamp(cue.endMs, sep), (v) => {
        const ms = parseTimestamp(v);
        if (!Number.isNaN(ms)) this.updateCue(cue.id, { endMs: ms });
      }),
    );
    times.appendChild(
      this.timeField(t("duration"), ((cue.endMs - cue.startMs) / 1000).toFixed(3), (v) => {
        const secs = parseFloat(v);
        if (!Number.isNaN(secs)) this.updateCue(cue.id, { endMs: cue.startMs + Math.round(secs * 1000) });
      }),
    );
    if (this.doc.format === "ass") times.appendChild(this.styleField(cue));
    this.detailEl.appendChild(times);

    const ta = document.createElement("textarea");
    ta.value = cue.text;
    ta.spellcheck = false;
    ta.addEventListener("input", () => this.updateCue(cue.id, { text: ta.value }, /*fromText*/ true));
    this.detailEl.appendChild(ta);
  }

  private timeField(label: string, value: string, onCommit: (v: string) => void): HTMLElement {
    const wrap = el("label", "se-field", label);
    const input = document.createElement("input");
    input.value = value;
    const commit = () => onCommit(input.value.trim());
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
    wrap.appendChild(input);
    return wrap;
  }

  // ASS style picker for the selected cue: the file's style names, plus the cue's own
  // style if the file didn't declare it. Writing sets the cue's Style Event field.
  private styleField(cue: Cue): HTMLElement {
    const wrap = el("label", "se-field se-stylefield", t("style"));
    const select = document.createElement("select");
    const current = cue.assFields?.Style ?? "Default";
    const names = this.doc.assStyles?.length ? [...this.doc.assStyles] : ["Default"];
    if (!names.includes(current)) names.unshift(current);
    for (const name of names) {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      select.appendChild(o);
    }
    select.value = current;
    select.addEventListener("change", () => {
      (cue.assFields ??= {}).Style = select.value;
      this.refreshRow(cue.id);
      this.markDirty();
    });
    wrap.appendChild(select);
    return wrap;
  }

  // --- editing operations --------------------------------------------------

  private updateCue(id: string, patch: Partial<Cue>, fromText = false): void {
    const cue = this.doc.cues.find((c) => c.id === id);
    if (!cue) return;
    Object.assign(cue, patch);
    this.refreshRow(id);
    this.timeline?.render();
    // Editing the text area should not re-render the detail (it would drop the caret).
    if (!fromText) this.renderDetail();
    this.markDirty();
  }

  private addCue(): void {
    const sel = this.selectedCue();
    const startMs = sel ? sel.endMs : (this.video?.currentTime ?? 0) * 1000;
    const cue = blankCue(Math.round(startMs));
    const insertAt = sel ? this.doc.cues.indexOf(sel) + 1 : this.doc.cues.length;
    this.doc.cues.splice(insertAt, 0, cue);
    this.renderList();
    this.select(cue.id);
    this.markDirty();
  }

  private removeCue(): void {
    const cue = this.selectedCue();
    if (!cue) return;
    const i = this.doc.cues.indexOf(cue);
    this.doc.cues.splice(i, 1);
    this.rows.get(cue.id)?.remove();
    this.rows.delete(cue.id);
    this.selectedId = null;
    this.renderList();
    const next = this.doc.cues[Math.min(i, this.doc.cues.length - 1)];
    if (next) this.select(next.id);
    else this.renderDetail();
    this.markDirty();
  }

  private shiftTimes(): void {
    const answer = prompt(t("shiftPrompt"), "0");
    if (answer === null) return;
    const delta = parseInt(answer, 10);
    if (Number.isNaN(delta) || delta === 0) return;
    for (const c of this.doc.cues) {
      c.startMs = Math.max(0, c.startMs + delta);
      c.endMs = Math.max(0, c.endMs + delta);
    }
    this.renderList();
    this.renderDetail();
    this.markDirty();
  }

  private fixOverlaps(): void {
    this.doc.cues = sortCues(this.doc.cues);
    let fixed = 0;
    for (let i = 1; i < this.doc.cues.length; i += 1) {
      const prev = this.doc.cues[i - 1];
      const cur = this.doc.cues[i];
      if (cur.startMs < prev.endMs) {
        prev.endMs = Math.min(prev.endMs, cur.startMs);
        fixed += 1;
      }
    }
    this.rows.clear();
    this.innerEl.textContent = "";
    this.renderList();
    this.renderDetail();
    if (fixed) this.markDirty();
    this.toast(t("overlapsFixed", { n: fixed }));
  }

  private setFormat(target: SubtitleFormat): void {
    if (target === this.doc.format) return;
    this.doc = convertDoc(this.doc, target);
    this.rows.clear();
    this.innerEl.textContent = "";
    this.renderList();
    this.renderDetail();
    this.markDirty();
  }

  private save(): void {
    const text = serializeSubtitles(this.doc);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `subtitles.${this.doc.format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // --- preview (minimal; upgraded to the mediaplay embed in a later phase) --

  private renderPreviewPlaceholder(): void {
    this.rightEl.textContent = "";
    const box = el("div", "se-noprev");
    box.appendChild(el("div", "", t("noVideo")));
    box.appendChild(el("div", "", t("loadVideoHint")));
    const btn = this.button(t("loadVideo"), () => this.pickVideo());
    box.appendChild(btn);
    this.rightEl.appendChild(box);
  }

  private pickVideo(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*,audio/*";
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      if (f) void this.loadVideo(f);
    });
    input.click();
  }

  // Load the video/audio into an embedded mediaplay player: this brings MKV/legacy remux,
  // Dolby/DTS audio decode and libass ASS rendering. embedded=true so the player's global
  // shortcuts and CC menu stay out of the editor's way; subedit drives subtitles via
  // setSubtitleText and reads currentTime from the underlying media element.
  private async loadVideo(file: File): Promise<void> {
    this.player?.destroy();
    this.video?.removeEventListener("timeupdate", this.onTimeUpdate);
    this.timeline?.stopPlayheadLoop();
    this.rightEl.textContent = "";
    const host = el("div", "se-playerhost") as HTMLDivElement;
    this.rightEl.appendChild(host);
    const bytes = new Uint8Array(await file.arrayBuffer());
    this.player = createMediaPlayer(host, { bytes, mime: file.type, filename: file.name }, { embedded: true });
    const v = this.player.getMediaElement() ?? null;
    this.video = v;
    if (v) {
      v.addEventListener("timeupdate", this.onTimeUpdate);
      v.addEventListener("loadedmetadata", () => {
        this.timeline?.fitAll();
        this.timeline?.render();
      });
      v.addEventListener("play", () => this.timeline?.startPlayheadLoop());
      v.addEventListener("pause", () => {
        this.timeline?.stopPlayheadLoop();
        this.timeline?.render();
      });
      v.addEventListener("seeked", () => this.timeline?.render());
    }
    this.pushSubtitles();
    if (bytes.length <= MAX_DECODE_BYTES) void this.extractWaveform(bytes);
    else this.timeline?.clearPeaks();
  }

  // Decode the media's audio to a waveform. decodeAudioData handles browser-decodable
  // audio (mp3/wav/m4a/ogg/webm and audio in some containers); codecs it can't decode
  // (e.g. E-AC-3 in MKV) leave the timeline peak-less, which is fine.
  private async extractWaveform(bytes: Uint8Array): Promise<void> {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const buffer = await ctx.decodeAudioData(bytes.slice().buffer);
      void ctx.close();
      this.timeline?.setPeaks(extractPeaks(buffer));
    } catch {
      this.timeline?.clearPeaks();
    }
  }

  // Feed the current (serialized) document to the preview so it renders the live edits.
  private pushSubtitles(immediate = false): void {
    if (!this.player) return;
    window.clearTimeout(this.subtitleTimer);
    const send = () => this.player?.setSubtitleText(serializeSubtitles(this.doc), `subtitles.${this.doc.format}`);
    if (immediate) send();
    else this.subtitleTimer = window.setTimeout(send, 300);
  }

  private onTimeUpdate = (): void => {
    if (!this.video) return;
    const ms = this.video.currentTime * 1000;
    const active = this.doc.cues.find((c) => ms >= c.startMs && ms < c.endMs);
    const id = active?.id ?? null;
    if (id === this.playingId) return;
    const prev = this.playingId;
    this.playingId = id;
    if (prev) this.refreshRow(prev);
    if (id) this.refreshRow(id);
  };

  private seekTo(ms: number, play = false): void {
    if (this.video) {
      this.video.currentTime = ms / 1000;
      if (play) void this.video.play().catch(() => {});
      else this.timeline?.render();
    }
  }

  // --- keyboard ------------------------------------------------------------

  private onKeydown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement;
    const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
    if (typing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.moveSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.moveSelection(-1);
    } else if (e.key === " ") {
      if (this.video) {
        e.preventDefault();
        if (this.video.paused) void this.video.play().catch(() => {});
        else this.video.pause();
      }
    }
  };

  private moveSelection(delta: number): void {
    const i = this.doc.cues.findIndex((c) => c.id === this.selectedId);
    const next = Math.max(0, Math.min(this.doc.cues.length - 1, (i < 0 ? 0 : i) + delta));
    const cue = this.doc.cues[next];
    if (cue) this.select(cue.id);
  }

  // --- misc ----------------------------------------------------------------

  private selectedCue(): Cue | undefined {
    return this.doc.cues.find((c) => c.id === this.selectedId);
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "se-btn";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  // An icon-only toolbar button: SVG glyph + a title/aria-label tooltip. mousedown is
  // suppressed so clicking the toolbar keeps focus and selection in the editor.
  private iconButton(svg: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "se-btn se-iconbtn";
    b.innerHTML = svg;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", onClick);
    return b;
  }

  private toast(msg: string): void {
    // Minimal, non-blocking status via the count element; hosts can style later.
    const prev = this.countEl.textContent;
    this.countEl.textContent = msg;
    setTimeout(() => {
      this.countEl.textContent = prev;
    }, 2500);
  }

  private markDirty(): void {
    this.countEl.textContent = t("cueCount", { n: this.doc.cues.length });
    this.pushSubtitles();
    this.opts.onChange?.();
  }

  // --- public API ----------------------------------------------------------

  getText(): string {
    return serializeSubtitles(this.doc);
  }
  getDoc(): SubtitleDoc {
    return this.doc;
  }
  loadPreviewMedia(file: File): void {
    void this.loadVideo(file);
  }
  focus(): void {
    this.root.focus();
  }
  destroy(): void {
    window.clearTimeout(this.subtitleTimer);
    this.video?.removeEventListener("timeupdate", this.onTimeUpdate);
    this.timeline?.destroy();
    this.timeline = null;
    this.player?.destroy();
    this.player = null;
    this.root.remove();
  }
}

function el(tag: string, className = "", text = ""): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function createSubtitleEditor(
  container: HTMLElement,
  input: SubtitleInput,
  opts: SubtitleEditorOptions = {},
): SubtitleEditorHandle {
  return new SubtitleEditor(container, input, opts);
}

// newCueId is re-exported for hosts that build cues headlessly.
export { newCueId };
