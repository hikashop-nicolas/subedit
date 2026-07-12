// A small karaoke editor for the selected ASS cue. It splits the line into syllables
// (from existing \k tags, or by words when there are none), lets you edit each
// syllable's text and its duration in centiseconds, distribute the cue's duration
// evenly, and writes {\k<cs>} tags back. Any leading override block (e.g. {\an8}\pos)
// is preserved before the syllables.

import type { Cue } from "./cue";
import { t } from "./i18n";

interface Syllable {
  cs: number;
  text: string;
}

function splitSyllables(text: string): { lead: string; syls: Syllable[] } {
  const kRe = /\{\\k[fo]?(\d+)\}([^{]*)/g;
  const syls: Syllable[] = [];
  let m: RegExpExecArray | null;
  let firstIdx = -1;
  while ((m = kRe.exec(text))) {
    if (firstIdx < 0) firstIdx = m.index;
    syls.push({ cs: parseInt(m[1], 10) || 0, text: m[2] });
  }
  if (syls.length) return { lead: text.slice(0, firstIdx), syls };
  const leadMatch = text.match(/^(?:\{[^}]*\})+/);
  const lead = leadMatch ? leadMatch[0] : "";
  const rest = text.slice(lead.length).replace(/\{[^}]*\}/g, "");
  const words = rest.match(/\S+\s*/g) ?? (rest ? [rest] : []);
  return { lead, syls: words.map((w) => ({ cs: 0, text: w })) };
}

let karaokeCss = false;
function injectCss(): void {
  if (karaokeCss) return;
  karaokeCss = true;
  const css = `
.se-kar-back{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;}
.se-kar{background:var(--se-bg,#1c1d21);color:var(--se-fg,#e6e7ea);border:1px solid var(--se-border,#33353b);border-radius:10px;
  width:min(520px,94vw);max-height:88vh;display:flex;flex-direction:column;font:13px system-ui,sans-serif;}
.se-kar-head,.se-kar-foot{display:flex;gap:8px;align-items:center;padding:10px 14px;}
.se-kar-head{border-bottom:1px solid var(--se-border,#33353b);} .se-kar-foot{border-top:1px solid var(--se-border,#33353b);}
.se-kar-head h3{margin:0;font-size:14px;flex:1 1 auto;}
.se-kar-body{overflow:auto;padding:8px 14px;display:flex;flex-direction:column;gap:6px;}
.se-kar-row{display:flex;gap:8px;align-items:center;}
.se-kar-row input.txt{flex:1 1 auto;}
.se-kar-row input{font:inherit;padding:4px 6px;border:1px solid var(--se-border,#33353b);border-radius:5px;background:var(--se-head,#25272c);color:var(--se-fg,#e6e7ea);}
.se-kar-row input.cs{width:70px;}
.se-kar-total{flex:1 1 auto;color:var(--se-muted,#9aa0aa);font-size:12px;}
.se-kar-total.warn{color:var(--se-warn,#b45309);}
.se-kar button{font:inherit;padding:5px 12px;border:1px solid var(--se-border,#33353b);border-radius:6px;background:var(--se-head,#25272c);color:var(--se-fg,#e6e7ea);cursor:pointer;}
.se-kar button:hover{border-color:var(--se-accent,#2563eb);}
`;
  const s = document.createElement("style");
  s.textContent = css;
  document.head.appendChild(s);
}

export function openKaraoke(cue: Cue, onApply: (text: string) => void): void {
  injectCss();
  const durationCs = Math.max(0, Math.round((cue.endMs - cue.startMs) / 10));
  const parsed = splitSyllables(cue.text);
  const lead = parsed.lead;
  let syls = parsed.syls;
  if (syls.length && syls.every((s) => s.cs === 0)) distribute();

  const back = document.createElement("div");
  back.className = "se-kar-back";
  const modal = document.createElement("div");
  modal.className = "se-kar";
  back.appendChild(modal);

  const head = document.createElement("div");
  head.className = "se-kar-head";
  const h3 = document.createElement("h3");
  h3.textContent = t("karaoke");
  const closeBtn = document.createElement("button");
  closeBtn.textContent = t("close");
  head.append(h3, closeBtn);

  const body = document.createElement("div");
  body.className = "se-kar-body";

  const foot = document.createElement("div");
  foot.className = "se-kar-foot";
  const total = document.createElement("span");
  total.className = "se-kar-total";
  const evenBtn = document.createElement("button");
  evenBtn.textContent = t("distribute");
  const applyBtn = document.createElement("button");
  applyBtn.textContent = t("apply");
  foot.append(total, evenBtn, applyBtn);

  modal.append(head, body, foot);
  document.body.appendChild(back);

  const close = () => back.remove();
  closeBtn.addEventListener("click", close);
  back.addEventListener("click", (e) => {
    if (e.target === back) close();
  });

  function distribute(): void {
    const n = syls.length || 1;
    const per = Math.round(durationCs / n);
    let acc = 0;
    syls.forEach((s, i) => {
      s.cs = i === n - 1 ? durationCs - acc : per;
      acc += s.cs;
    });
  }

  function updateTotal(): void {
    const sum = syls.reduce((a, s) => a + (s.cs || 0), 0);
    total.textContent = t("karaokeTotal", { sum, dur: durationCs });
    total.classList.toggle("warn", sum !== durationCs);
  }

  function rebuild(): void {
    body.textContent = "";
    syls.forEach((s, i) => {
      const row = document.createElement("div");
      row.className = "se-kar-row";
      const txt = document.createElement("input");
      txt.className = "txt";
      txt.value = s.text;
      txt.addEventListener("change", () => (syls[i].text = txt.value));
      const cs = document.createElement("input");
      cs.className = "cs";
      cs.type = "number";
      cs.value = String(s.cs);
      cs.addEventListener("change", () => {
        syls[i].cs = parseInt(cs.value, 10) || 0;
        updateTotal();
      });
      row.append(txt, cs);
      body.appendChild(row);
    });
    updateTotal();
  }

  evenBtn.addEventListener("click", () => {
    distribute();
    rebuild();
  });
  applyBtn.addEventListener("click", () => {
    const out = lead + syls.map((s) => `{\\k${s.cs}}${s.text}`).join("");
    onApply(out);
    close();
  });

  rebuild();
}
