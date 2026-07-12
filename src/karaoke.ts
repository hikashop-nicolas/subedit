// Karaoke editor for the selected ASS cue: a waveform of the cue's time range with one
// block per syllable (and optional blank gaps). Drag a boundary to retime, drag a block
// to move it, play the audio with a moving playhead, add blanks, edit each syllable's
// text below. Apply writes {\kf<cs>} fill tags (the left-to-right karaoke sweep); blanks
// become {\kf<cs>} with no text.

import type { Cue } from "./cue";
import { t } from "./i18n";

interface Seg {
  type: "syl" | "blank";
  text: string;
  cs: number;
}

function parseSegments(text: string): { lead: string; segs: Seg[] } {
  const kRe = /\{\\k[fo]?(\d+)\}([^{]*)/g;
  const segs: Seg[] = [];
  let m: RegExpExecArray | null;
  let firstIdx = -1;
  while ((m = kRe.exec(text))) {
    if (firstIdx < 0) firstIdx = m.index;
    const txt = m[2];
    segs.push({ type: txt.trim() === "" ? "blank" : "syl", text: txt, cs: parseInt(m[1], 10) || 0 });
  }
  if (segs.length) return { lead: text.slice(0, firstIdx), segs };
  const leadMatch = text.match(/^(?:\{[^}]*\})+/);
  const lead = leadMatch ? leadMatch[0] : "";
  const rest = text.slice(lead.length).replace(/\{[^}]*\}/g, "");
  const words = rest.match(/\S+\s*/g) ?? (rest ? [rest] : []);
  return { lead, segs: words.map((w) => ({ type: "syl" as const, text: w, cs: 0 })) };
}

let karaokeCss = false;
function injectCss(): void {
  if (karaokeCss) return;
  karaokeCss = true;
  const css = `
.se-kar-back{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;}
.se-kar{background:var(--se-bg,#1c1d21);color:var(--se-fg,#e6e7ea);border:1px solid var(--se-border,#33353b);border-radius:10px;
  width:min(760px,95vw);max-height:90vh;display:flex;flex-direction:column;font:13px system-ui,sans-serif;}
.se-kar-head,.se-kar-foot{display:flex;gap:8px;align-items:center;padding:10px 14px;}
.se-kar-head{border-bottom:1px solid var(--se-border,#33353b);} .se-kar-foot{border-top:1px solid var(--se-border,#33353b);}
.se-kar-head h3{margin:0;font-size:14px;flex:1 1 auto;}
.se-kar canvas{display:block;width:100%;height:120px;touch-action:none;cursor:default;}
.se-kar-list{overflow:auto;padding:6px 14px;display:flex;flex-direction:column;gap:5px;max-height:34vh;}
.se-kar-row{display:flex;gap:8px;align-items:center;}
.se-kar-row.sel{outline:2px solid var(--se-accent,#2563eb);border-radius:6px;outline-offset:1px;}
.se-kar-row input.txt{flex:1 1 auto;}
.se-kar-row input,.se-kar-row button{font:inherit;padding:4px 6px;border:1px solid var(--se-border,#33353b);border-radius:5px;background:var(--se-head,#25272c);color:var(--se-fg,#e6e7ea);}
.se-kar-row .cs{width:64px;} .se-kar-row button{cursor:pointer;}
.se-kar-total{flex:1 1 auto;color:var(--se-muted,#9aa0aa);font-size:12px;}
.se-kar-total.warn{color:var(--se-warn,#b45309);}
.se-kar button.act{cursor:pointer;padding:5px 12px;border:1px solid var(--se-border,#33353b);border-radius:6px;background:var(--se-head,#25272c);color:var(--se-fg,#e6e7ea);}
.se-kar button.act:hover{border-color:var(--se-accent,#2563eb);}
`;
  const s = document.createElement("style");
  s.textContent = css;
  document.head.appendChild(s);
}

const H = 120;
const EDGE = 6;

export function openKaraoke(cue: Cue, video: HTMLMediaElement | null, peaks: { peaks: Float32Array; peaksPerSec: number } | null, onApply: (text: string) => void): void {
  injectCss();
  const startMs = cue.startMs;
  const durMs = Math.max(1, cue.endMs - cue.startMs);
  const durCs = Math.round(durMs / 10);
  const parsed = parseSegments(cue.text);
  const lead = parsed.lead;
  let segs = parsed.segs;
  if (!segs.length) segs = [{ type: "syl", text: cue.text || " ", cs: durCs }];
  if (segs.every((s) => s.cs === 0)) distribute();
  let selected = 0;

  const back = document.createElement("div");
  back.className = "se-kar-back";
  const modal = document.createElement("div");
  modal.className = "se-kar";
  back.appendChild(modal);

  const head = document.createElement("div");
  head.className = "se-kar-head";
  const h3 = document.createElement("h3");
  h3.textContent = t("karaoke");
  const playBtn = document.createElement("button");
  playBtn.className = "act";
  playBtn.textContent = "▶ " + t("karaokePlay");
  const closeBtn = document.createElement("button");
  closeBtn.className = "act";
  closeBtn.textContent = t("close");
  head.append(h3, playBtn, closeBtn);

  const canvas = document.createElement("canvas");
  const list = document.createElement("div");
  list.className = "se-kar-list";

  const foot = document.createElement("div");
  foot.className = "se-kar-foot";
  const total = document.createElement("span");
  total.className = "se-kar-total";
  const blankBtn = document.createElement("button");
  blankBtn.className = "act";
  blankBtn.textContent = t("addBlank");
  const evenBtn = document.createElement("button");
  evenBtn.className = "act";
  evenBtn.textContent = t("distribute");
  const applyBtn = document.createElement("button");
  applyBtn.className = "act";
  applyBtn.textContent = t("apply");
  foot.append(total, blankBtn, evenBtn, applyBtn);

  modal.append(head, canvas, list, foot);
  document.body.appendChild(back);

  const ctx = canvas.getContext("2d")!;
  const dpr = Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
  let width = 0;
  const pal = getComputedStyle(modal);
  const col = (n: string, f: string) => pal.getPropertyValue(n).trim() || f;
  const C = {
    bg: col("--se-head", "#25272c"),
    wave: col("--se-muted", "#9aa0aa"),
    syl: col("--se-sel", "#1e3a5f"),
    sel: col("--se-accent", "#2563eb"),
    fg: col("--se-fg", "#e6e7ea"),
    border: col("--se-border", "#33353b"),
  };

  function distribute(): void {
    const n = segs.length || 1;
    const per = Math.round(durCs / n);
    let acc = 0;
    segs.forEach((s, i) => {
      s.cs = i === n - 1 ? Math.max(1, durCs - acc) : per;
      acc += s.cs;
    });
  }

  const totalCs = () => segs.reduce((a, s) => a + s.cs, 0);
  const spanCs = () => Math.max(durCs, totalCs());
  const xOf = (cs: number) => (cs / spanCs()) * width;
  const csOf = (x: number) => (x / width) * spanCs();

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  function render(): void {
    if (!width) return;
    ctx.clearRect(0, 0, width, H);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, width, H);
    // Waveform slice for the cue range.
    if (peaks) {
      const pps = peaks.peaksPerSec;
      const mid = H / 2;
      const half = H / 2 - 8;
      ctx.strokeStyle = C.wave;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      for (let x = 0; x < width; x++) {
        const ms = startMs + (csOf(x) * 10);
        const b = Math.floor((ms / 1000) * pps);
        const p = peaks.peaks[b] ?? 0;
        ctx.moveTo(x + 0.5, mid - p * half);
        ctx.lineTo(x + 0.5, mid + p * half);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Segment blocks.
    let cum = 0;
    segs.forEach((s, i) => {
      const x0 = xOf(cum);
      const x1 = xOf(cum + s.cs);
      cum += s.cs;
      const w = Math.max(1, x1 - x0);
      if (s.type === "blank") {
        ctx.fillStyle = C.border;
        ctx.globalAlpha = 0.25;
        ctx.fillRect(x0, 18, w, H - 36);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = C.syl;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(x0, 18, w, H - 36);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = i === selected ? C.sel : C.border;
      ctx.lineWidth = i === selected ? 2 : 1;
      ctx.strokeRect(x0, 18, w, H - 36);
      if (s.type === "syl" && w > 16) {
        ctx.fillStyle = C.fg;
        ctx.font = "12px system-ui";
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0 + 2, 18, w - 4, H - 36);
        ctx.clip();
        ctx.fillText(s.text.trim(), x0 + 4, H / 2 + 4);
        ctx.restore();
      }
    });
    // Cue-end marker (if syllables under/overrun the cue).
    if (totalCs() !== durCs) {
      const x = xOf(durCs);
      ctx.strokeStyle = C.sel;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Playhead.
    if (video && !video.paused) {
      const cs = (video.currentTime * 1000 - startMs) / 10;
      const x = xOf(cs);
      if (x >= 0 && x <= width) {
        ctx.strokeStyle = C.sel;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
    }
  }

  // --- drag: resize a boundary or move a block ---
  let drag: { kind: "boundary" | "move"; index: number; grabCs: number; startCs: number[] } | null = null;
  const boundaries = (): number[] => {
    const b: number[] = [];
    let cum = 0;
    for (const s of segs) {
      cum += s.cs;
      b.push(cum);
    }
    return b; // b[i] = right edge of segment i (in cs)
  };

  canvas.addEventListener("pointerdown", (e) => {
    const x = e.offsetX;
    const cs = csOf(x);
    const bounds = boundaries();
    // Which boundary (right edge of a segment) is near?
    let hitB = -1;
    for (let i = 0; i < bounds.length; i++) if (Math.abs(x - xOf(bounds[i])) <= EDGE) hitB = i;
    if (hitB >= 0) {
      drag = { kind: "boundary", index: hitB, grabCs: cs, startCs: segs.map((s) => s.cs) };
    } else {
      // Which block body?
      let cum = 0;
      let idx = -1;
      for (let i = 0; i < segs.length; i++) {
        if (cs >= cum && cs < cum + segs[i].cs) {
          idx = i;
          break;
        }
        cum += segs[i].cs;
      }
      if (idx >= 0) {
        selected = idx;
        renderList();
        drag = { kind: "move", index: idx, grabCs: cs, startCs: segs.map((s) => s.cs) };
      }
    }
    if (drag) {
      canvas.setPointerCapture(e.pointerId);
      render();
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) {
      // hover cursor
      const bounds = boundaries();
      const near = bounds.some((b) => Math.abs(e.offsetX - xOf(b)) <= EDGE);
      canvas.style.cursor = near ? "ew-resize" : "grab";
      return;
    }
    const delta = Math.round(csOf(e.offsetX) - drag.grabCs);
    const cs = drag.startCs.slice();
    if (drag.kind === "boundary") {
      const i = drag.index;
      if (i < segs.length - 1) {
        // internal boundary: move between seg i and i+1 (constant total)
        const d = Math.max(-(cs[i] - 5), Math.min(cs[i + 1] - 5, delta));
        cs[i] += d;
        cs[i + 1] -= d;
      } else {
        // last edge: change last segment length (changes total)
        cs[i] = Math.max(5, cs[i] + delta);
      }
    } else {
      // move block: shift its boundaries, taking from prev / giving to next
      const i = drag.index;
      const prev = i - 1;
      const next = i + 1;
      let d = delta;
      if (prev >= 0) d = Math.max(-(cs[prev] - 5), d);
      if (next < cs.length) d = Math.min(cs[next] - 5, d);
      if (prev >= 0) cs[prev] += d;
      if (next < cs.length) cs[next] -= d;
      if (prev < 0) cs[i] = Math.max(5, cs[i]); // first block: nothing before to move into
    }
    segs.forEach((s, k) => (s.cs = cs[k]));
    render();
    renderCsInputs();
  });
  const endDrag = (e: PointerEvent) => {
    if (drag) {
      drag = null;
      canvas.releasePointerCapture(e.pointerId);
      render();
      updateTotal();
    }
  };
  canvas.addEventListener("pointerup", endDrag);

  // --- syllable list (text / type / delete) ---
  function renderCsInputs(): void {
    [...list.querySelectorAll<HTMLInputElement>(".cs")].forEach((inp, i) => {
      if (segs[i]) inp.value = String(segs[i].cs);
    });
  }
  function updateTotal(): void {
    total.textContent = t("karaokeTotal", { sum: totalCs(), dur: durCs });
    total.classList.toggle("warn", totalCs() !== durCs);
  }
  function renderList(): void {
    list.textContent = "";
    segs.forEach((s, i) => {
      const row = document.createElement("div");
      row.className = "se-kar-row" + (i === selected ? " sel" : "");
      const typeBtn = document.createElement("button");
      typeBtn.textContent = s.type === "blank" ? "␣" : "T";
      typeBtn.title = t("addBlank");
      typeBtn.addEventListener("click", () => {
        s.type = s.type === "blank" ? "syl" : "blank";
        if (s.type === "blank") s.text = "";
        else if (!s.text.trim()) s.text = "…";
        renderList();
        render();
      });
      const txt = document.createElement("input");
      txt.className = "txt";
      txt.value = s.text;
      txt.disabled = s.type === "blank";
      txt.addEventListener("input", () => {
        s.text = txt.value;
        render();
      });
      txt.addEventListener("focus", () => {
        selected = i;
        renderList();
        render();
      });
      const cs = document.createElement("input");
      cs.className = "cs";
      cs.type = "number";
      cs.value = String(s.cs);
      cs.addEventListener("change", () => {
        s.cs = parseInt(cs.value, 10) || 0;
        render();
        updateTotal();
      });
      const del = document.createElement("button");
      del.textContent = "✕";
      del.addEventListener("click", () => {
        segs.splice(i, 1);
        if (!segs.length) segs.push({ type: "syl", text: "…", cs: durCs });
        selected = Math.min(selected, segs.length - 1);
        renderList();
        render();
        updateTotal();
      });
      row.append(typeBtn, txt, cs, del);
      list.appendChild(row);
    });
    updateTotal();
  }

  blankBtn.addEventListener("click", () => {
    // Insert a blank after the selected block, taking time from it.
    const at = Math.min(selected + 1, segs.length);
    const take = Math.min(25, Math.max(5, Math.floor((segs[selected]?.cs ?? 25) / 2)));
    if (segs[selected]) segs[selected].cs = Math.max(5, segs[selected].cs - take);
    segs.splice(at, 0, { type: "blank", text: "", cs: take });
    selected = at;
    renderList();
    render();
  });
  evenBtn.addEventListener("click", () => {
    distribute();
    renderList();
    render();
  });

  // --- playback ---
  let raf = 0;
  const stopPlay = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    if (video && !video.paused) video.pause();
    playBtn.textContent = "▶ " + t("karaokePlay");
  };
  playBtn.addEventListener("click", () => {
    if (!video) return;
    if (raf) {
      stopPlay();
      return;
    }
    video.currentTime = startMs / 1000;
    void video.play().catch(() => {});
    playBtn.textContent = "⏸";
    const tick = () => {
      if (!video || video.paused || video.currentTime * 1000 >= cue.endMs) {
        stopPlay();
        render();
        return;
      }
      render();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });

  const close = () => {
    stopPlay();
    ro.disconnect();
    back.remove();
  };
  closeBtn.addEventListener("click", close);
  back.addEventListener("click", (e) => {
    if (e.target === back) close();
  });
  applyBtn.addEventListener("click", () => {
    const out = lead + segs.map((s) => `{\\kf${s.cs}}${s.type === "blank" ? "" : s.text}`).join("");
    onApply(out);
    close();
  });

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  renderList();
  resize();
}
