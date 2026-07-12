// The bottom timeline: a canvas showing the audio waveform, the cues as draggable
// blocks, a time ruler and a playhead. Click to seek, wheel to zoom (deltaY) or pan
// (deltaX / shift+wheel), drag a cue body to move it or its edges to retime. Works with
// no audio decoded (blocks + playhead only); peaks are added via setPeaks when available.

import type { Cue } from "./cue";

export interface TimelineCallbacks {
  getCues: () => Cue[];
  getDuration: () => number; // media duration (s); 0 if unknown
  getCurrentTime: () => number; // s
  getSelectedId: () => string | null;
  onSeek: (sec: number) => void;
  onSelectCue: (id: string) => void;
  onRetime: (id: string, startMs: number, endMs: number, commit: boolean) => void;
}

const H = 104; // canvas CSS height
const RULER_H = 16;
const EDGE_PX = 5; // grab zone for a cue edge
const SNAP_PX = 7; // snap a dragged edge to a neighbour within this pixel distance
const MIN_PPS = 2; // min pixels per second (zoomed out)
const MAX_PPS = 400; // max pixels per second (zoomed in)
const PEAKS_PER_SEC = 100; // waveform bucket resolution

type Palette = {
  bg: string;
  ruler: string;
  wave: string;
  cue: string;
  cueSel: string;
  cueText: string;
  playhead: string;
  border: string;
};

type DragMode = "move" | "start" | "end";

export class Timeline {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private cb: TimelineCallbacks;
  private pxPerSec = 20;
  private scrollSec = 0; // time at the left edge
  private width = 0;
  private peaks: Float32Array | null = null;
  private peaksPerSec = PEAKS_PER_SEC;
  private pal!: Palette;
  private ro: ResizeObserver | null = null;
  private raf = 0;
  private drag: { id: string; mode: DragMode; grabSec: number; startMs: number; endMs: number } | null = null;
  private pan: { startX: number; startScroll: number; moved: boolean } | null = null;
  private dpr = Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1);

  constructor(callbacks: TimelineCallbacks) {
    this.cb = callbacks;
  }

  mount(container: HTMLElement): void {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "se-timeline";
    this.canvas.style.width = "100%";
    this.canvas.style.height = `${H}px`;
    this.canvas.style.display = "block";
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.readPalette(container);

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onHover);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("dblclick", this.onDblClick);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas);
    this.resize();
  }

  private readPalette(el: HTMLElement): void {
    const cs = getComputedStyle(el);
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    this.pal = {
      bg: v("--se-head", "#25272c"),
      ruler: v("--se-muted", "#9aa0aa"),
      wave: v("--se-muted", "#9aa0aa"),
      cue: v("--se-sel", "#1e3a5f"),
      cueSel: v("--se-accent", "#60a5fa"),
      cueText: v("--se-fg", "#e6e7ea"),
      playhead: v("--se-accent", "#60a5fa"),
      border: v("--se-border", "#33353b"),
    };
  }

  // Absolute-peak buckets (PEAKS_PER_SEC per second) mixed down from the audio buffer.
  setPeaks(peaks: Float32Array, peaksPerSec = PEAKS_PER_SEC): void {
    this.peaks = peaks;
    this.peaksPerSec = peaksPerSec;
    this.fitAll();
    this.render();
  }

  clearPeaks(): void {
    this.peaks = null;
    this.render();
  }

  // Fit the whole media (or the last cue) into the view.
  fitAll(): void {
    const dur = this.totalDuration();
    if (dur > 0 && this.width > 0) {
      this.pxPerSec = clamp(this.width / dur, MIN_PPS, MAX_PPS);
      this.scrollSec = 0;
    }
  }

  private totalDuration(): number {
    const d = this.cb.getDuration();
    if (d && Number.isFinite(d)) return d;
    const cues = this.cb.getCues();
    const last = cues.length ? Math.max(...cues.map((c) => c.endMs)) / 1000 : 0;
    return Math.max(last, this.peaks ? this.peaks.length / this.peaksPerSec : 0, 1);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width) return;
    this.width = rect.width;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(H * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.pxPerSec * this.totalDuration() < this.width) this.fitAll();
    this.render();
  }

  // Keep a smooth playhead while the media plays.
  startPlayheadLoop(): void {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      this.followPlayhead();
      this.render();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stopPlayheadLoop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private followPlayhead(): void {
    const t = this.cb.getCurrentTime();
    const left = this.scrollSec;
    const right = this.scrollSec + this.width / this.pxPerSec;
    if (t < left || t > right - 0.5) this.scrollSec = Math.max(0, t - (this.width / this.pxPerSec) * 0.3);
  }

  private xOf(sec: number): number {
    return (sec - this.scrollSec) * this.pxPerSec;
  }
  private secOf(x: number): number {
    return this.scrollSec + x / this.pxPerSec;
  }

  render(): void {
    const ctx = this.ctx;
    const w = this.width;
    if (!w) return;
    ctx.clearRect(0, 0, w, H);
    ctx.fillStyle = this.pal.bg;
    ctx.fillRect(0, 0, w, H);

    this.drawRuler();
    this.drawWaveform();
    this.drawCues();
    this.drawPlayhead();

    ctx.strokeStyle = this.pal.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, RULER_H + 0.5);
    ctx.lineTo(w, RULER_H + 0.5);
    ctx.stroke();
  }

  private drawRuler(): void {
    const ctx = this.ctx;
    ctx.fillStyle = this.pal.ruler;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    // Choose a "nice" tick interval targeting ~80px spacing.
    const targetSec = 80 / this.pxPerSec;
    const step = niceStep(targetSec);
    const first = Math.ceil(this.scrollSec / step) * step;
    const decimals = step < 1 ? (step < 0.1 ? 2 : 1) : 0;
    for (let t = first; this.xOf(t) < this.width; t += step) {
      const x = this.xOf(t);
      ctx.fillRect(x, RULER_H - 5, 1, 5);
      ctx.fillText(clock(t, decimals), x + 3, RULER_H / 2);
    }
  }

  private drawWaveform(): void {
    if (!this.peaks) return;
    const ctx = this.ctx;
    const midY = RULER_H + (H - RULER_H) / 2;
    const halfH = (H - RULER_H) / 2 - 4;
    ctx.strokeStyle = this.pal.wave;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (let x = 0; x < this.width; x++) {
      const t0 = this.secOf(x);
      const t1 = this.secOf(x + 1);
      let peak = 0;
      const b0 = Math.max(0, Math.floor(t0 * this.peaksPerSec));
      const b1 = Math.min(this.peaks.length - 1, Math.ceil(t1 * this.peaksPerSec));
      for (let b = b0; b <= b1; b++) if (this.peaks[b] > peak) peak = this.peaks[b];
      if (b1 < 0 || b0 >= this.peaks.length) continue;
      const h = peak * halfH;
      ctx.moveTo(x + 0.5, midY - h);
      ctx.lineTo(x + 0.5, midY + h);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private cueRect(c: Cue): { x0: number; x1: number } {
    return { x0: this.xOf(c.startMs / 1000), x1: this.xOf(c.endMs / 1000) };
  }

  private drawCues(): void {
    const ctx = this.ctx;
    const top = RULER_H + 6;
    const bottom = H - 6;
    const selId = this.cb.getSelectedId();
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (const c of this.cb.getCues()) {
      const { x0, x1 } = this.cueRect(c);
      if (x1 < 0 || x0 > this.width) continue;
      const sel = c.id === selId;
      const commented = c.assKind === "Comment";
      const w = Math.max(2, x1 - x0);
      ctx.fillStyle = this.pal.cue;
      ctx.globalAlpha = (sel ? 0.5 : 0.32) * (commented ? 0.4 : 1);
      roundRect(ctx, x0, top, w, bottom - top, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = sel ? this.pal.cueSel : this.pal.border;
      ctx.lineWidth = sel ? 2 : 1;
      roundRect(ctx, x0, top, w, bottom - top, 3);
      ctx.stroke();
      // Karaoke syllable divisions (\k / \kf) and fade (\fad) triangles, for ASS cues.
      this.drawCueMarks(c, x0, x1, top, bottom);
      // Label, clipped to the block.
      if (w > 24) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0 + 3, top, w - 6, bottom - top);
        ctx.clip();
        ctx.fillStyle = this.pal.cueText;
        ctx.fillText(c.text.replace(/\n/g, " ").slice(0, 80), x0 + 5, (top + bottom) / 2);
        ctx.restore();
      }
    }
  }

  // Fade-in/out triangles and karaoke syllable boundaries drawn inside a cue's block.
  private drawCueMarks(c: Cue, x0: number, x1: number, top: number, bottom: number): void {
    if (c.assKind === undefined || !c.text.includes("\\")) return;
    const ctx = this.ctx;
    const durMs = c.endMs - c.startMs || 1;
    const pxPerMs = (x1 - x0) / durMs;
    // Karaoke boundaries.
    const kRe = /\\k[fo]?(\d+)/g;
    let m: RegExpExecArray | null;
    let cumMs = 0;
    ctx.strokeStyle = this.pal.cueSel;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    while ((m = kRe.exec(c.text))) {
      cumMs += (parseInt(m[1], 10) || 0) * 10;
      const x = x0 + cumMs * pxPerMs;
      if (x > x0 && x < x1) {
        ctx.beginPath();
        ctx.moveTo(x, top + 2);
        ctx.lineTo(x, bottom - 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // Fade triangles (drawn alongside any karaoke divisions).
    const fad = c.text.match(/\\fad\((\d+),(\d+)\)/);
    if (!fad) return;
    ctx.fillStyle = this.pal.cueSel;
    ctx.globalAlpha = 0.35;
    const inW = Math.min(x1 - x0, parseInt(fad[1], 10) * pxPerMs);
    const outW = Math.min(x1 - x0, parseInt(fad[2], 10) * pxPerMs);
    if (inW > 1) {
      ctx.beginPath();
      ctx.moveTo(x0, bottom);
      ctx.lineTo(x0 + inW, bottom);
      ctx.lineTo(x0, top);
      ctx.closePath();
      ctx.fill();
    }
    if (outW > 1) {
      ctx.beginPath();
      ctx.moveTo(x1, bottom);
      ctx.lineTo(x1 - outW, bottom);
      ctx.lineTo(x1, top);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawPlayhead(): void {
    const x = this.xOf(this.cb.getCurrentTime());
    if (x < 0 || x > this.width) return;
    const ctx = this.ctx;
    ctx.strokeStyle = this.pal.playhead;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  // --- interaction ---------------------------------------------------------

  private hitTest(x: number): { id: string; mode: DragMode } | null {
    for (const c of this.cb.getCues()) {
      const { x0, x1 } = this.cueRect(c);
      if (x >= x0 - EDGE_PX && x <= x1 + EDGE_PX) {
        if (Math.abs(x - x0) <= EDGE_PX) return { id: c.id, mode: "start" };
        if (Math.abs(x - x1) <= EDGE_PX) return { id: c.id, mode: "end" };
        if (x > x0 && x < x1) return { id: c.id, mode: "move" };
      }
    }
    return null;
  }

  private onPointerDown = (e: PointerEvent): void => {
    const x = e.offsetX;
    const y = e.offsetY;
    const hit = this.hitTest(x);
    if (hit && y > RULER_H) {
      const c = this.cb.getCues().find((k) => k.id === hit.id)!;
      this.cb.onSelectCue(hit.id);
      this.drag = { id: hit.id, mode: hit.mode, grabSec: this.secOf(x), startMs: c.startMs, endMs: c.endMs };
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.addEventListener("pointermove", this.onPointerMove);
      this.canvas.addEventListener("pointerup", this.onPointerUp);
      this.render();
      return;
    }
    // Empty area: start a pan. A click without dragging seeks (handled on pointerup).
    this.pan = { startX: x, startScroll: this.scrollSec, moved: false };
    this.canvas.style.cursor = "grabbing";
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.addEventListener("pointermove", this.onPanMove);
    this.canvas.addEventListener("pointerup", this.onPanUp);
  };

  private onPanMove = (e: PointerEvent): void => {
    if (!this.pan) return;
    const dx = e.offsetX - this.pan.startX;
    if (Math.abs(dx) > 3) this.pan.moved = true;
    this.scrollSec = Math.max(0, this.pan.startScroll - dx / this.pxPerSec);
    this.render();
  };

  private onPanUp = (e: PointerEvent): void => {
    if (this.pan && !this.pan.moved) this.cb.onSeek(Math.max(0, this.secOf(e.offsetX)));
    this.pan = null;
    this.canvas.style.cursor = "grab";
    this.canvas.releasePointerCapture(e.pointerId);
    this.canvas.removeEventListener("pointermove", this.onPanMove);
    this.canvas.removeEventListener("pointerup", this.onPanUp);
    this.render();
  };

  private onHover = (e: PointerEvent): void => {
    if (this.drag || this.pan) return;
    const hit = e.offsetY > RULER_H ? this.hitTest(e.offsetX) : null;
    this.canvas.style.cursor = !hit ? "grab" : hit.mode === "move" ? "move" : "ew-resize";
  };

  // Nearest snap target (another cue's edge, or the playhead) within SNAP_PX of `ms`,
  // else `ms` unchanged. Keeps cue edges aligned to their neighbours.
  private snapMs(ms: number, excludeId: string): number {
    const thresholdMs = (SNAP_PX / this.pxPerSec) * 1000;
    let best = ms;
    let bestD = thresholdMs;
    for (const c of this.cb.getCues()) {
      if (c.id === excludeId) continue;
      for (const t of [c.startMs, c.endMs]) {
        const d = Math.abs(ms - t);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
    }
    const playheadMs = this.cb.getCurrentTime() * 1000;
    if (Math.abs(ms - playheadMs) < bestD) best = Math.round(playheadMs);
    return best;
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.drag) return;
    const deltaSec = this.secOf(e.offsetX) - this.drag.grabSec;
    let start = this.drag.startMs;
    let end = this.drag.endMs;
    const dms = Math.round(deltaSec * 1000);
    const id = this.drag.id;
    if (this.drag.mode === "move") {
      start += dms;
      end += dms;
      if (start < 0) {
        end -= start;
        start = 0;
      }
      // Snap whichever edge lands nearest a target, shifting both by the same amount.
      const ss = this.snapMs(start, id);
      const se = this.snapMs(end, id);
      const adj = ss !== start && (se === end || Math.abs(ss - start) <= Math.abs(se - end)) ? ss - start : se !== end ? se - end : 0;
      start += adj;
      end += adj;
    } else if (this.drag.mode === "start") {
      start = Math.min(Math.max(0, this.snapMs(start + dms, id)), end - 10);
    } else {
      end = Math.max(this.snapMs(end + dms, id), start + 10);
    }
    this.cb.onRetime(id, start, end, false);
    this.render();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.drag) {
      const c = this.cb.getCues().find((k) => k.id === this.drag!.id);
      if (c) this.cb.onRetime(this.drag.id, c.startMs, c.endMs, true);
    }
    this.drag = null;
    this.canvas.releasePointerCapture(e.pointerId);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
  };

  private onDblClick = (e: MouseEvent): void => {
    // Double-click empty area seeks precisely (single click already seeks; kept for parity).
    if (!this.hitTest(e.offsetX)) this.cb.onSeek(Math.max(0, this.secOf(e.offsetX)));
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      // Pan.
      const panSec = (e.deltaX || e.deltaY) / this.pxPerSec;
      this.scrollSec = Math.max(0, this.scrollSec + panSec);
    } else {
      // Zoom around the cursor.
      const anchorSec = this.secOf(e.offsetX);
      const factor = Math.exp(-e.deltaY * 0.002);
      this.pxPerSec = clamp(this.pxPerSec * factor, MIN_PPS, MAX_PPS);
      this.scrollSec = Math.max(0, anchorSec - e.offsetX / this.pxPerSec);
    }
    this.render();
  };

  refreshTheme(container: HTMLElement): void {
    this.readPalette(container);
    this.render();
  }

  destroy(): void {
    this.stopPlayheadLoop();
    this.ro?.disconnect();
    this.canvas.remove();
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function niceStep(target: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  for (const m of [1, 2, 5, 10]) if (pow * m >= target) return pow * m;
  return pow * 10;
}

function clock(sec: number, decimals = 0): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(Math.floor(n)).padStart(2, "0");
  const secStr = decimals ? ss.toFixed(decimals).padStart(3 + decimals, "0") : p(ss);
  return h ? `${h}:${p(m)}:${secStr}` : `${m}:${secStr}`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
