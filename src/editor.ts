// The subtitle editor UI and the createSubtitleEditor entry point.
//
// Layout: a toolbar on top; below it a row with the cue list + a detail editor on the
// left and a video/audio preview on the right. The cue list is virtualized so files
// with thousands of cues stay responsive. The preview is a plain <video> in this phase
// (double-click a cue to seek, current cue highlights); a later phase swaps in the
// mediaplay embed for full-format playback and live subtitle rendering.

import {
  type Cue,
  type AssStyle,
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
import { styleNames, hexToAssColor, makeDefaultStyle, uniqueStyleName, getPlayRes } from "./ass";
import { openStyleEditor, openScriptProperties } from "./styles-editor";
import { openKaraoke } from "./karaoke";
import { setLocale, t, alignmentOptions } from "./i18n";
import { Timeline } from "./waveform";
import { createMediaPlayer, extractWaveformPeaks, type MediaPlayerHandle } from "mediaplay";

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
  styles: svgIcon('<path d="M5 3.5h6M8 3.5v9M5.5 12.5h5"/><path d="M11.5 8.5l2-2 1.5 1.5-2 2z"/>'),
  script: svgIcon('<rect x="3" y="2.5" width="10" height="11" rx="1"/><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3"/>'),
  mic: svgIcon('<rect x="6" y="2" width="4" height="7" rx="2"/><path d="M4 7a4 4 0 0 0 8 0M8 11v2.5M6 13.5h4"/>'),
  fade: svgIcon('<path d="M2 13l5-10v10z" fill="currentColor" stroke="none"/><path d="M14 13L9 3v10z" fill="currentColor" stroke="none" opacity="0.5"/>'),
  transform: svgIcon('<path d="M12.5 5A5.5 5.5 0 1 0 13 8.5"/><path d="M11 2.5v3h3"/>'),
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
.se-right{flex:1 1 45%;display:flex;flex-direction:column;min-width:0;background:#000;position:relative;}
.se-listhead,.se-row{display:grid;grid-template-columns:44px 96px 96px 52px 44px 1fr;align-items:center;gap:6px;padding:0 8px;}
.se-ass .se-listhead,.se-ass .se-row{grid-template-columns:44px 96px 96px 52px 44px 110px 1fr;}
.se-actor{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--se-muted);}
.se-listhead{height:28px;border-bottom:1px solid var(--se-border);color:var(--se-muted);font-size:11px;text-transform:uppercase;letter-spacing:.03em;background:var(--se-head);flex:0 0 auto;}
.se-scroll{flex:1 1 auto;overflow-y:auto;position:relative;}
.se-inner{position:relative;width:100%;}
.se-row{position:absolute;left:0;right:0;height:${ROW_H}px;border-bottom:1px solid var(--se-border);cursor:pointer;box-sizing:border-box;}
.se-row:hover{background:var(--se-head);}
.se-row.sel{background:var(--se-sel);color:var(--se-sel-fg);}
.se-row.playing{box-shadow:inset 3px 0 0 var(--se-accent);}
.se-row.commented .se-text{opacity:.5;font-style:italic;}
.se-row.commented .se-num::after{content:" ⊘";color:var(--se-muted);}
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
.se-assbox{display:flex;flex-direction:column;gap:6px;}
.se-assextras{flex-wrap:wrap;}
.se-margins{flex-wrap:wrap;align-items:center;}
.se-grouplabel{font-size:10px;color:var(--se-muted);text-transform:uppercase;letter-spacing:.03em;align-self:center;}
.se-effectgroup{gap:3px;}
.se-effectrow{display:flex;gap:6px;align-items:flex-end;}
.se-effectparams{display:flex;gap:6px;align-items:flex-end;}
.se-effectgroup select,.se-selfield select{font:inherit;padding:3px 6px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);}
.se-numfield input{width:56px;}
.se-actorfield input,.se-effectfield input{width:100px;}
.se-checkfield{flex-direction:row;align-items:center;gap:5px;}
.se-checkfield input{width:auto;}
.se-stylerow{display:flex;gap:4px;align-items:center;}
.se-stylefield select{font:inherit;padding:3px 6px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);}
.se-styleedit{padding:3px 6px;}
.se-detail textarea{font:inherit;min-height:56px;resize:vertical;padding:6px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);}
.se-inlinebar{display:flex;gap:5px;align-items:center;}
.se-inbtn{font:600 12px system-ui;width:26px;height:24px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);cursor:pointer;}
.se-inbtn:hover{border-color:var(--se-accent);}
.se-in-i{font-style:italic;}
.se-in-u{text-decoration:underline;}
.se-incolor{width:26px;height:24px;padding:0;border:1px solid var(--se-border);border-radius:5px;background:none;cursor:pointer;}
.se-inalign{font:inherit;height:24px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);}
.se-inbtn.on,.se-posbtn.on{background:var(--se-accent);border-color:var(--se-accent);color:#fff;}
.se-posoverlay{position:absolute;z-index:5;cursor:crosshair;background:rgba(37,99,235,0.08);box-shadow:inset 0 0 0 2px var(--se-accent);}
.se-posdone{position:absolute;top:8px;right:8px;cursor:pointer;font:600 12px system-ui;padding:4px 10px;border:1px solid var(--se-accent);border-radius:6px;background:var(--se-accent);color:#fff;}
.se-poshint{position:absolute;bottom:8px;left:0;right:0;text-align:center;font:600 11px system-ui;color:#fff;text-shadow:0 1px 2px #000;pointer-events:none;}
.se-fadepop{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;padding:6px;border:1px solid var(--se-border);border-radius:6px;background:var(--se-bg);}
.se-fadepop input{width:70px;}
.se-empty,.se-noprev{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;text-align:center;padding:24px;color:var(--se-muted);}
.se-noprev{color:#aab;}
.se-empty h3{margin:0;color:var(--se-fg);font-size:15px;}
.se-playerhost{flex:1 1 auto;min-height:0;width:100%;height:100%;}
.se-timeline-wrap{flex:0 0 auto;border-top:1px solid var(--se-border);background:var(--se-head);position:relative;}
.se-timeline{touch-action:none;cursor:grab;}
.se-wave-status{position:absolute;top:20px;left:10px;z-index:1;font-size:11px;color:var(--se-muted);pointer-events:none;}
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
  private stylesBtn!: HTMLButtonElement;
  private scriptBtn!: HTMLButtonElement;
  private leftEl!: HTMLDivElement;
  private headEl!: HTMLDivElement;
  private rightEl!: HTMLDivElement;
  private player: MediaPlayerHandle | null = null;
  private video: HTMLMediaElement | null = null;
  private timeline: Timeline | null = null;
  private waveAbort: AbortController | null = null;
  private waveStatusEl: HTMLDivElement | null = null;
  private detailTextarea: HTMLTextAreaElement | null = null;
  private posOverlay: HTMLDivElement | null = null;
  private positionCueId: string | null = null;
  private wavePeaks: { peaks: Float32Array; peaksPerSec: number } | null = null;
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

    // New ASS style (ASS only); edit lives next to the per-cue style dropdown.
    this.stylesBtn = this.iconButton(ICON.styles, t("addStyle"), () => this.addStyle());
    this.stylesBtn.style.display = this.doc.format === "ass" ? "" : "none";
    bar.appendChild(this.stylesBtn);

    // Script properties (ASS only).
    this.scriptBtn = this.iconButton(ICON.script, t("scriptProps"), () =>
      openScriptProperties({ getDoc: () => this.doc, onChange: () => this.markDirty() }),
    );
    this.scriptBtn.style.display = this.doc.format === "ass" ? "" : "none";
    bar.appendChild(this.scriptBtn);

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
    const left = el("div", "se-left") as HTMLDivElement;
    this.leftEl = left;
    left.classList.toggle("se-ass", this.doc.format === "ass");

    this.headEl = el("div", "se-listhead") as HTMLDivElement;
    left.appendChild(this.headEl);
    this.renderListHead();

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
    this.waveStatusEl = el("div", "se-wave-status") as HTMLDivElement;
    strip.appendChild(this.waveStatusEl);
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

  // Build the list header, adding an Actor column for ASS.
  private renderListHead(): void {
    this.headEl.textContent = "";
    this.headEl.appendChild(el("div", "se-num", t("colIndex")));
    this.headEl.appendChild(el("div", "", t("colStart")));
    this.headEl.appendChild(el("div", "", t("colEnd")));
    this.headEl.appendChild(el("div", "", t("colDuration")));
    this.headEl.appendChild(el("div", "", t("colCps")));
    if (this.doc.format === "ass") this.headEl.appendChild(el("div", "", t("actor")));
    this.headEl.appendChild(el("div", "", t("colText")));
  }

  private makeRow(cue: Cue): HTMLDivElement {
    const row = el("div", "se-row") as HTMLDivElement;
    row.dataset.id = cue.id;
    row.appendChild(el("div", "se-cell se-num"));
    row.appendChild(el("div", "se-cell se-time se-start"));
    row.appendChild(el("div", "se-cell se-time se-end"));
    row.appendChild(el("div", "se-cell se-time se-dur"));
    row.appendChild(el("div", "se-cell se-cps"));
    if (this.doc.format === "ass") row.appendChild(el("div", "se-cell se-actor"));
    row.appendChild(el("div", "se-cell se-text"));
    row.addEventListener("click", () => this.select(cue.id));
    row.addEventListener("dblclick", () => this.seekTo(cue.startMs, true));
    return row;
  }

  private fillRow(row: HTMLDivElement, cue: Cue, index: number): void {
    const sep = this.doc.format === "srt" ? "," : ".";
    const cell = (c: string) => row.querySelector<HTMLElement>(`.${c}`)!;
    cell("se-num").textContent = String(index + 1);
    cell("se-start").textContent = formatTimestamp(cue.startMs, sep);
    cell("se-end").textContent = formatTimestamp(cue.endMs, sep);
    cell("se-dur").textContent = ((cue.endMs - cue.startMs) / 1000).toFixed(1);
    const c = cps(cue);
    const cpsCell = cell("se-cps");
    cpsCell.textContent = c ? c.toFixed(0) : "";
    cpsCell.className = "se-cell se-cps" + (c > CPS_BAD ? " bad" : c > CPS_WARN ? " warn" : "");
    const actorCell = row.querySelector<HTMLElement>(".se-actor");
    if (actorCell) actorCell.textContent = cue.assFields?.Name ?? "";
    cell("se-text").textContent = cue.text.replace(/\n/g, " ⏎ ");
    row.classList.toggle("sel", cue.id === this.selectedId);
    row.classList.toggle("playing", cue.id === this.playingId);
    row.classList.toggle("commented", cue.assKind === "Comment");
  }

  private refreshRow(id: string): void {
    const row = this.rows.get(id);
    const index = this.doc.cues.findIndex((c) => c.id === id);
    if (row && index >= 0) this.fillRow(row, this.doc.cues[index], index);
  }

  // --- selection + detail editor -------------------------------------------

  private select(id: string): void {
    if (this.selectedId === id) return;
    if (this.posOverlay) this.exitPosition();
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
    if (this.doc.format === "ass") this.detailEl.appendChild(this.assExtrasRow(cue));

    const ta = document.createElement("textarea");
    ta.value = cue.text;
    ta.spellcheck = false;
    this.detailTextarea = ta;
    ta.addEventListener("input", () => this.updateCue(cue.id, { text: ta.value }, /*fromText*/ true));
    // ASS: an inline-formatting toolbar that wraps the selection in override tags.
    if (this.doc.format === "ass") this.detailEl.appendChild(this.inlineToolbar(cue, ta));
    this.detailEl.appendChild(ta);
  }

  // Buttons that wrap the current selection in the cue's text area with ASS override
  // tags (bold/italic/underline/colour) or set the line alignment (\anN).
  private inlineToolbar(cue: Cue, ta: HTMLTextAreaElement): HTMLElement {
    const bar = el("div", "se-inlinebar");

    const wrap = (before: string, after: string): void => {
      const s = ta.selectionStart ?? ta.value.length;
      const e = ta.selectionEnd ?? s;
      ta.value = ta.value.slice(0, s) + before + ta.value.slice(s, e) + after + ta.value.slice(e);
      ta.focus();
      ta.setSelectionRange(s + before.length, e + before.length);
      this.updateCue(cue.id, { text: ta.value }, true);
    };

    const tagBtn = (label: string, on: string, off: string, cls: string): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `se-inbtn ${cls}`;
      b.textContent = label;
      b.title = label;
      b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the text selection
      b.addEventListener("click", () => wrap(`{\\${on}}`, `{\\${off}}`));
      return b;
    };
    bar.append(
      tagBtn("B", "b1", "b0", "se-in-b"),
      tagBtn("I", "i1", "i0", "se-in-i"),
      tagBtn("U", "u1", "u0", "se-in-u"),
    );

    // Colour: wrap the selection in {\c&HBBGGRR&}...{\r} (reset to the style at the end).
    const colour = document.createElement("input");
    colour.type = "color";
    colour.className = "se-incolor";
    colour.title = t("stylePrimary");
    colour.addEventListener("mousedown", (e) => e.stopPropagation());
    colour.addEventListener("input", () => wrap(`{\\c${hexToAssColor(colour.value)}}`, "{\\r}"));
    bar.appendChild(colour);

    // Fade in/out: prepend {\fad(in,out)} (ms).
    const fade = document.createElement("button");
    fade.type = "button";
    fade.className = "se-inbtn";
    fade.innerHTML = ICON.fade;
    fade.title = t("fade");
    fade.addEventListener("mousedown", (e) => e.preventDefault());
    fade.addEventListener("click", () => this.openFade(cue, ta));
    bar.appendChild(fade);

    // Karaoke: syllable timing (\kf).
    const kar = document.createElement("button");
    kar.type = "button";
    kar.className = "se-inbtn";
    kar.innerHTML = ICON.mic;
    kar.title = t("karaoke");
    kar.addEventListener("mousedown", (e) => e.preventDefault());
    kar.addEventListener("click", () =>
      openKaraoke(cue, this.video ?? null, this.wavePeaks, (text) => {
        ta.value = text;
        this.updateCue(cue.id, { text }, true);
      }),
    );
    bar.appendChild(kar);

    // Transform: rotation / scale / spacing / blur.
    const tr = document.createElement("button");
    tr.type = "button";
    tr.className = "se-inbtn";
    tr.innerHTML = ICON.transform;
    tr.title = t("transform");
    tr.addEventListener("mousedown", (e) => e.preventDefault());
    tr.addEventListener("click", () => this.openTransform(cue, ta));
    bar.appendChild(tr);

    // Alignment: the cue's inline \anN override. "No alignment" removes it (the line
    // then uses its style's alignment). Reflects the current override.
    const align = document.createElement("select");
    align.className = "se-inalign";
    align.title = t("styleAlign");
    const optNone = document.createElement("option");
    optNone.value = "none";
    optNone.textContent = t("noAlign");
    align.appendChild(optNone);
    for (const { value, label } of alignmentOptions()) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      align.appendChild(o);
    }
    align.value = cue.text.match(/\\an([1-9])/)?.[1] ?? "none";
    align.addEventListener("change", () => {
      const stripped = cue.text.replace(/\{\\an[1-9]\}/g, "").replace(/\\an[1-9]/g, "").replace(/\{\}/g, "");
      ta.value = align.value === "none" ? stripped : `{\\an${align.value}}` + stripped;
      this.updateCue(cue.id, { text: ta.value }, true);
      if (this.doc.format === "ass") this.renderDetail(); // margin V visibility depends on this
    });
    bar.appendChild(align);

    // Position picker: click on the preview to place the line (\pos).
    const posBtn = document.createElement("button");
    posBtn.type = "button";
    posBtn.className = "se-inbtn se-posbtn" + (this.positionCueId === cue.id ? " on" : "");
    posBtn.textContent = "⌖";
    posBtn.title = t("positionPick");
    posBtn.addEventListener("mousedown", (e) => e.preventDefault());
    posBtn.addEventListener("click", () => this.togglePosition(cue));
    bar.appendChild(posBtn);

    return bar;
  }

  // --- position picker (\pos via clicking the preview) ---------------------

  // The video's on-screen content box (accounting for letterbox), in viewport coords.
  private videoContentRect(): { left: number; top: number; width: number; height: number } {
    const rect = this.video!.getBoundingClientRect();
    const vid = this.video as HTMLVideoElement;
    const vW = vid.videoWidth || rect.width;
    const vH = vid.videoHeight || rect.height;
    const scale = Math.min(rect.width / vW, rect.height / vH) || 1;
    const width = vW * scale;
    const height = vH * scale;
    return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
  }

  private togglePosition(cue: Cue): void {
    if (this.posOverlay) {
      this.exitPosition();
      return;
    }
    if (!this.video) {
      this.toast(t("posNeedsVideo"));
      return;
    }
    this.positionCueId = cue.id;
    const ov = el("div", "se-posoverlay") as HTMLDivElement;
    ov.title = t("positionPick");
    // Cover only the video's content box so only clicks on the picture set a position.
    const cr = this.videoContentRect();
    const rr = this.rightEl.getBoundingClientRect();
    ov.style.left = `${cr.left - rr.left}px`;
    ov.style.top = `${cr.top - rr.top}px`;
    ov.style.width = `${cr.width}px`;
    ov.style.height = `${cr.height}px`;
    // Click sets a static \pos; drag turns it into a \move (the line animates from where
    // you pressed to where you release). The subtitle follows the cursor live during drag.
    let down: { x: number; y: number; moved: boolean } | null = null;
    const cur = () => this.doc.cues.find((k) => k.id === this.positionCueId);
    ov.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY, moved: false };
      ov.setPointerCapture(e.pointerId);
      const c = cur();
      if (c) this.setCuePosition(c, e.clientX, e.clientY);
    });
    ov.addEventListener("pointermove", (e) => {
      if (!down || !(e.buttons & 1)) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true;
      const c = cur();
      if (c) this.setCuePosition(c, e.clientX, e.clientY); // live follow
    });
    ov.addEventListener("pointerup", (e) => {
      const c = cur();
      if (down && down.moved && c) this.setCueMove(c, down.x, down.y, e.clientX, e.clientY);
      down = null;
    });
    // Explicit "Done" affordance (plus Esc and the toolbar toggle) to leave the mode.
    const done = document.createElement("button");
    done.className = "se-posdone";
    done.textContent = t("done");
    done.addEventListener("pointerdown", (e) => e.stopPropagation());
    done.addEventListener("click", () => this.exitPosition());
    const hint = el("div", "se-poshint", t("moveHint"));
    ov.append(done, hint);
    this.rightEl.appendChild(ov);
    this.posOverlay = ov;
    document.addEventListener("keydown", this.onPosKey, true);
    this.renderDetail(); // highlight the toggle
  }

  private onPosKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this.posOverlay) {
      e.preventDefault();
      this.exitPosition();
    }
  };

  private exitPosition(): void {
    document.removeEventListener("keydown", this.onPosKey, true);
    this.posOverlay?.remove();
    this.posOverlay = null;
    this.positionCueId = null;
    this.renderDetail();
  }

  // Map a viewport point to PlayRes coordinates, or null if outside the picture.
  private clientToPlayRes(clientX: number, clientY: number): { px: number; py: number } | null {
    if (!this.video) return null;
    const cr = this.videoContentRect();
    const nx = (clientX - cr.left) / cr.width;
    const ny = (clientY - cr.top) / cr.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
    const res = getPlayRes(this.doc);
    return { px: Math.round(nx * res.x), py: Math.round(ny * res.y) };
  }

  private applyCueTag(cue: Cue, tag: string): void {
    const stripped = cue.text.replace(/\\(pos|move)\([^)]*\)/g, "").replace(/\{\}/g, "");
    cue.text = `{${tag}}` + stripped;
    if (this.detailTextarea) this.detailTextarea.value = cue.text;
    this.refreshRow(cue.id);
    this.markDirty();
  }

  private setCuePosition(cue: Cue, clientX: number, clientY: number): void {
    const p = this.clientToPlayRes(clientX, clientY);
    if (p) this.applyCueTag(cue, `\\pos(${p.px},${p.py})`);
  }

  private setCueMove(cue: Cue, x1: number, y1: number, x2: number, y2: number): void {
    const a = this.clientToPlayRes(x1, y1);
    const b = this.clientToPlayRes(x2, y2);
    if (a && b) this.applyCueTag(cue, `\\move(${a.px},${a.py},${b.px},${b.py})`);
  }

  // --- fade ----------------------------------------------------------------

  private openFade(cue: Cue, ta: HTMLTextAreaElement): void {
    this.detailEl.querySelector(".se-fadepop")?.remove();
    const cur = cue.text.match(/\\fad\((\d+),(\d+)\)/);
    const pop = el("div", "se-fadepop");
    const field = (label: string, val: string): { wrap: HTMLElement; input: HTMLInputElement } => {
      const wrap = el("label", "se-field", label);
      const input = document.createElement("input");
      input.type = "number";
      input.value = val;
      wrap.appendChild(input);
      return { wrap, input };
    };
    const fin = field(t("fadeIn"), cur?.[1] ?? "200");
    const fout = field(t("fadeOut"), cur?.[2] ?? "200");
    const apply = document.createElement("button");
    apply.className = "se-btn";
    apply.textContent = t("apply");
    apply.addEventListener("click", () => {
      const i = parseInt(fin.input.value, 10) || 0;
      const o = parseInt(fout.input.value, 10) || 0;
      const stripped = cue.text.replace(/\\fad\([^)]*\)/g, "").replace(/\{\}/g, "");
      ta.value = `{\\fad(${i},${o})}` + stripped;
      this.updateCue(cue.id, { text: ta.value }, true);
      pop.remove();
    });
    pop.append(fin.wrap, fout.wrap, apply);
    this.detailEl.appendChild(pop);
    fin.input.focus();
  }

  // Transform popover: rotation (\frz), scale (\fscx/\fscy), spacing (\fsp), blur (\blur).
  private openTransform(cue: Cue, ta: HTMLTextAreaElement): void {
    this.detailEl.querySelector(".se-fadepop")?.remove();
    const get = (re: RegExp, def: string): string => cue.text.match(re)?.[1] ?? def;
    const pop = el("div", "se-fadepop");
    const field = (label: string, val: string): HTMLInputElement => {
      const wrap = el("label", "se-field", label);
      const input = document.createElement("input");
      input.type = "number";
      input.value = val;
      wrap.appendChild(input);
      pop.appendChild(wrap);
      return input;
    };
    const frz = field(t("styleAngle"), get(/\\frz(-?[\d.]+)/, "0"));
    const fscx = field(t("styleScaleX"), get(/\\fscx([\d.]+)/, "100"));
    const fscy = field(t("styleScaleY"), get(/\\fscy([\d.]+)/, "100"));
    const fsp = field(t("styleSpacing"), get(/\\fsp(-?[\d.]+)/, "0"));
    const blur = field(t("blur"), get(/\\blur([\d.]+)/, "0"));

    // Animate: wrap the transform in \t so it eases from the style default to these values.
    const animWrap = el("label", "se-field se-checkfield", t("animate"));
    const anim = document.createElement("input");
    anim.type = "checkbox";
    anim.checked = /\\t\(/.test(cue.text);
    animWrap.appendChild(anim);
    pop.appendChild(animWrap);

    const apply = document.createElement("button");
    apply.className = "se-btn";
    apply.textContent = t("apply");
    apply.addEventListener("click", () => {
      const stripped = cue.text.replace(/\\t\([^)]*\)/g, "").replace(/\\(frz|fscx|fscy|fsp|blur)-?[\d.]+/g, "").replace(/\{\}/g, "");
      const tags: string[] = [];
      const add = (tag: string, v: string, def: number) => {
        if (v !== "" && parseFloat(v) !== def) tags.push(`\\${tag}${v}`);
      };
      add("frz", frz.value, 0);
      add("fscx", fscx.value, 100);
      add("fscy", fscy.value, 100);
      add("fsp", fsp.value, 0);
      add("blur", blur.value, 0);
      const body = tags.length ? (anim.checked ? `\\t(${tags.join("")})` : tags.join("")) : "";
      ta.value = (body ? `{${body}}` : "") + stripped;
      this.updateCue(cue.id, { text: ta.value }, true);
      pop.remove();
    });
    pop.appendChild(apply);
    this.detailEl.appendChild(pop);
    frz.focus();
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
  // style if the file didn't declare it. Writing sets the cue's Style Event field; the
  // adjacent pencil opens the editor for the selected style.
  private styleField(cue: Cue): HTMLElement {
    const wrap = el("label", "se-field se-stylefield", t("style"));
    const row = el("div", "se-stylerow");
    const select = document.createElement("select");
    const current = cue.assFields?.Style ?? "Default";
    const declared = styleNames(this.doc);
    const names = declared.length ? [...declared] : ["Default"];
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
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "se-btn se-iconbtn se-styleedit";
    edit.innerHTML = ICON.styles;
    edit.title = t("editStyle");
    edit.setAttribute("aria-label", t("editStyle"));
    edit.addEventListener("click", () => this.editStyle(select.value));
    row.append(select, edit);
    wrap.appendChild(row);
    return wrap;
  }

  // The remaining ASS Event fields for the selected cue, grouped into a fields row
  // (disable / actor / layer / effect) and a margins row.
  private assExtrasRow(cue: Cue): HTMLElement {
    const box = el("div", "se-assbox");
    const row = el("div", "se-times se-assextras");

    const cwrap = el("label", "se-field se-checkfield", t("disabled"));
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = cue.assKind === "Comment";
    cb.addEventListener("change", () => {
      cue.assKind = cb.checked ? "Comment" : "Dialogue";
      this.refreshRow(cue.id);
      this.timeline?.render();
      this.markDirty();
    });
    cwrap.appendChild(cb);
    row.append(cwrap, this.assField(cue, "Name", t("actor"), "text", "se-actorfield"), this.assField(cue, "Layer", t("layer"), "number", "se-numfield"), this.assEffectField(cue));
    box.appendChild(row);

    // Margins group: Left / Right, and Vertical only when the line is top/bottom aligned.
    const margins = el("div", "se-times se-margins");
    margins.appendChild(el("span", "se-grouplabel", t("marginsLabel")));
    margins.append(this.assField(cue, "MarginL", t("marginL"), "number", "se-numfield"), this.assField(cue, "MarginR", t("marginR"), "number", "se-numfield"));
    if (![4, 5, 6].includes(this.effectiveAlign(cue))) margins.appendChild(this.assField(cue, "MarginV", t("marginV"), "number", "se-numfield"));
    box.appendChild(margins);
    return box;
  }

  // The cue's alignment: an inline \an override, else the assigned style's, else 2.
  private effectiveAlign(cue: Cue): number {
    const an = cue.text.match(/\\an([1-9])/);
    if (an) return parseInt(an[1], 10);
    const style = this.doc.styles?.find((s) => s.name === (cue.assFields?.Style ?? "Default"));
    return parseInt(style?.fields.Alignment ?? "2", 10) || 2;
  }

  // Effect: a type dropdown (None / Banner / Scroll up / Scroll down; Karaoke only if the
  // cue already uses it) plus parameter fields for the chosen effect.
  private assEffectField(cue: Cue): HTMLElement {
    const PREFIX: Record<string, string> = { banner: "Banner", scrollup: "Scroll up", scrolldown: "Scroll down", karaoke: "Karaoke" };
    type ParamSpec = { label: string; def: string; options?: [string, string][] };
    const SPECS: Record<string, ParamSpec[]> = {
      banner: [
        { label: t("effDelay"), def: "40" },
        { label: t("direction"), def: "0", options: [["0", t("rightToLeft")], ["1", t("leftToRight")]] },
        { label: t("effFade"), def: "0" },
      ],
      scrollup: [{ label: t("effY1"), def: "0" }, { label: t("effY2"), def: "0" }, { label: t("effDelay"), def: "40" }, { label: t("effFade"), def: "0" }],
      scrolldown: [{ label: t("effY1"), def: "0" }, { label: t("effY2"), def: "0" }, { label: t("effDelay"), def: "40" }, { label: t("effFade"), def: "0" }],
    };
    const cur = cue.assFields?.Effect ?? "";
    const type = /^banner/i.test(cur) ? "banner" : /^scroll up/i.test(cur) ? "scrollup" : /^scroll down/i.test(cur) ? "scrolldown" : /^karaoke/i.test(cur) ? "karaoke" : "none";

    const group = el("div", "se-field se-effectgroup");
    group.append(el("span", "", t("effect")));
    const rowEl = el("div", "se-effectrow");
    const sel = document.createElement("select");
    const opts: [string, string][] = [["none", t("effectNone")], ["banner", t("banner")], ["scrollup", t("scrollUp")], ["scrolldown", t("scrollDown")]];
    if (type === "karaoke") opts.push(["karaoke", t("karaoke")]);
    for (const [v, l] of opts) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = l;
      sel.appendChild(o);
    }
    sel.value = type;
    const params = el("div", "se-effectparams");
    rowEl.append(sel, params);
    group.appendChild(rowEl);

    const setEffect = (val: string) => {
      (cue.assFields ??= {}).Effect = val;
      this.refreshRow(cue.id);
      this.markDirty();
    };
    const build = (t2: string, parts: string[], commit: boolean): void => {
      params.textContent = "";
      if (t2 === "none") {
        if (commit) setEffect("");
        return;
      }
      if (t2 === "karaoke") {
        if (commit) setEffect("Karaoke");
        return;
      }
      const spec = SPECS[t2];
      const inputs = spec.map((s, i) => {
        const wrap = el("label", "se-field " + (s.options ? "se-selfield" : "se-numfield"), s.label);
        let input: HTMLInputElement | HTMLSelectElement;
        if (s.options) {
          const sel2 = document.createElement("select");
          for (const [v, l] of s.options) {
            const o = document.createElement("option");
            o.value = v;
            o.textContent = l;
            sel2.appendChild(o);
          }
          sel2.value = parts[i] ?? s.def;
          input = sel2;
        } else {
          const n = document.createElement("input");
          n.type = "number";
          n.value = parts[i] ?? s.def;
          input = n;
        }
        wrap.appendChild(input);
        params.appendChild(wrap);
        return input;
      });
      const rebuild = () => setEffect(`${PREFIX[t2]};${inputs.map((x) => x.value || "0").join(";")}`);
      inputs.forEach((x) => x.addEventListener("change", rebuild));
      if (commit) rebuild();
    };
    sel.addEventListener("change", () => build(sel.value, [], true));
    build(type, cur.split(";").slice(1), false);
    return group;
  }

  private assField(cue: Cue, key: string, label: string, type: "text" | "number", cls: string, datalist?: string[]): HTMLElement {
    const wrap = el("label", `se-field ${cls}`, label);
    const input = document.createElement("input");
    input.type = type;
    input.value = cue.assFields?.[key] ?? (type === "number" ? "0" : "");
    if (datalist) {
      const id = `se-dl-${key}`;
      input.setAttribute("list", id);
      const dl = document.createElement("datalist");
      dl.id = id;
      for (const v of datalist) {
        const o = document.createElement("option");
        o.value = v;
        dl.appendChild(o);
      }
      wrap.appendChild(dl);
      input.title = t("effectHint");
    }
    const commit = () => {
      (cue.assFields ??= {})[key] = input.value;
      this.refreshRow(cue.id);
      this.markDirty();
    };
    input.addEventListener("change", commit);
    wrap.appendChild(input);
    return wrap;
  }

  private addStyle(): void {
    this.doc.styles ??= [];
    const style = makeDefaultStyle(uniqueStyleName(this.doc, "New style"));
    this.doc.styles.push(style);
    this.markDirty();
    this.renderDetail();
    this.openStyleEditor(style);
  }

  private editStyle(name: string): void {
    this.doc.styles ??= [];
    let style = this.doc.styles.find((s) => s.name === name);
    if (!style) {
      style = makeDefaultStyle(name);
      this.doc.styles.push(style);
    }
    this.openStyleEditor(style);
  }

  private openStyleEditor(style: AssStyle): void {
    openStyleEditor(
      {
        getDoc: () => this.doc,
        onChange: () => {
          this.renderDetail(); // refresh the style dropdown options + selection
          this.markDirty();
        },
        onRenameStyle: (from, to) => {
          for (const c of this.doc.cues) if (c.assFields?.Style === from) c.assFields.Style = to;
        },
      },
      style,
    );
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
    this.stylesBtn.style.display = target === "ass" ? "" : "none";
    this.scriptBtn.style.display = target === "ass" ? "" : "none";
    this.leftEl.classList.toggle("se-ass", target === "ass");
    this.renderListHead();
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
    if (this.posOverlay) this.exitPosition();
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
    void this.extractWaveform(bytes);
  }

  // Decode the media's audio to a waveform via mediaplay, which handles every codec it can
  // play (incl. Dolby/DTS the browser can't decode) and streams the PCM so large files
  // don't buffer in memory. Aborts if another media file is loaded meanwhile.
  private async extractWaveform(bytes: Uint8Array): Promise<void> {
    this.waveAbort?.abort();
    const ac = new AbortController();
    this.waveAbort = ac;
    this.wavePeaks = null;
    this.timeline?.clearPeaks();
    this.setWaveStatus(t("extractingWave"));
    try {
      const result = await extractWaveformPeaks(bytes, {
        base: new URL("libav/", document.baseURI).toString(),
        signal: ac.signal,
        durationHint: this.video?.duration || undefined,
        onProgress: (r) => this.setWaveStatus(`${t("extractingWave")} ${Math.round(r * 100)}%`),
      });
      if (ac.signal.aborted) return;
      if (result?.peaks.length) {
        this.wavePeaks = result;
        this.timeline?.setPeaks(result.peaks, result.peaksPerSec);
      }
    } catch {
      /* leave the timeline peak-less */
    } finally {
      if (this.waveAbort === ac) {
        this.waveAbort = null;
        this.setWaveStatus("");
      }
    }
  }

  private setWaveStatus(text: string): void {
    if (this.waveStatusEl) this.waveStatusEl.textContent = text;
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
    document.removeEventListener("keydown", this.onPosKey, true);
    this.waveAbort?.abort();
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
