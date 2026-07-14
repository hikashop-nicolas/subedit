// The editor stylesheet, injected once. Uses the shared row-height metric so the virtual
// list rows and the CSS agree. Theme variables switch light/dark via prefers-color-scheme.
import { ROW_H } from "./metrics";

let stylesInjected = false;
export function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
.se-root{--se-bg:#fff;--se-fg:#1a1a1e;--se-muted:#667;--se-border:#e2e4ea;--se-sel:#dbeafe;--se-sel-fg:#0b1220;--se-head:#f6f7f9;--se-warn:#b45309;--se-bad:#b91c1c;--se-accent:#2563eb;
  display:flex;flex-direction:column;height:100%;min-height:0;position:relative;font-family:system-ui,sans-serif;color:var(--se-fg);background:var(--se-bg);font-size:13px;}
.se-toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:6px 8px;border-bottom:1px solid var(--se-border);background:var(--se-head);}
.se-toolbar b{font-size:13px;margin-right:6px;}
.se-toolbar .se-sp{flex:1 1 auto;}
.se-tracks{display:flex;gap:4px;align-items:center;padding:4px 8px;border-bottom:1px solid var(--se-border);background:var(--se-head);overflow-x:auto;flex-shrink:0;}
.se-toolbar{flex-shrink:0;}
.se-track{position:relative;display:flex;align-items:center;gap:4px;padding:3px 4px 3px 10px;border:1px solid var(--se-border);border-radius:6px;background:var(--se-bg);white-space:nowrap;flex-shrink:0;overflow:hidden;}
.se-track-add{flex-shrink:0;}
.se-track.on{border-color:var(--se-accent);background:var(--se-sel);color:var(--se-sel-fg);}
.se-track.busy{border-color:var(--se-accent);}
.se-track-prog{position:absolute;left:0;bottom:0;height:2px;background:var(--se-accent);transition:width .2s linear;pointer-events:none;}
.se-track-name{cursor:pointer;font-size:12px;}
.se-jobstrip{display:none;align-items:center;gap:8px;padding:5px 10px;border-bottom:1px solid var(--se-border);background:var(--se-head);flex-shrink:0;}
.se-jobstrip.on{display:flex;}
.se-jobstrip.err .se-job-fill{background:var(--se-bad);}
.se-jobstrip.err .se-job-label{color:var(--se-bad);}
.se-job-label{font-size:12px;color:var(--se-muted);white-space:nowrap;}
.se-job-bar{flex:1 1 auto;height:6px;border-radius:3px;background:var(--se-border);overflow:hidden;}
.se-job-fill{height:100%;background:var(--se-accent);transition:width .2s linear;}
.se-job-btn{border:1px solid var(--se-border);background:var(--se-bg);color:var(--se-fg);cursor:pointer;width:26px;height:24px;border-radius:6px;font-size:12px;line-height:1;flex-shrink:0;}
.se-job-btn:hover{border-color:var(--se-accent);color:var(--se-accent);}
.se-track-x{border:none;background:none;color:var(--se-muted);cursor:pointer;font-size:14px;line-height:1;padding:0 3px;border-radius:4px;}
.se-track-x:hover{color:var(--se-bad);}
.se-track-add{border:1px dashed var(--se-border);background:none;color:var(--se-muted);cursor:pointer;width:24px;height:24px;border-radius:6px;font-size:15px;line-height:1;}
.se-track-add:hover{border-color:var(--se-accent);color:var(--se-accent);}
.se-btn{font:inherit;padding:4px 9px;border:1px solid var(--se-border);background:var(--se-bg);color:var(--se-fg);border-radius:6px;cursor:pointer;}
.se-btn:hover{border-color:var(--se-accent);}
.se-btn:disabled{opacity:.5;cursor:default;}
.se-iconbtn{display:inline-flex;align-items:center;justify-content:center;padding:5px 7px;color:var(--se-fg);}
.se-iconbtn:hover{color:var(--se-accent);}
.se-iconbtn.on{color:var(--se-accent);background:var(--se-sel);border-color:var(--se-accent);}
.se-iconbtn svg{display:block;}
.se-count{color:var(--se-muted);font-size:12px;}
.se-body{flex:1 1 auto;display:flex;min-height:0;}
.se-left{flex:1 1 55%;display:flex;flex-direction:column;min-width:0;min-height:0;border-right:1px solid var(--se-border);}
.se-right{flex:1 1 45%;display:flex;flex-direction:column;min-width:0;background:#000;position:relative;}
.se-listhead,.se-row{display:grid;grid-template-columns:44px 96px 96px 52px 44px 1fr;align-items:center;gap:6px;padding:0 8px;}
.se-ass .se-listhead,.se-ass .se-row{grid-template-columns:44px 96px 96px 52px 44px 110px 1fr;}
.se-actor{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--se-muted);}
.se-listhead{height:28px;border-bottom:1px solid var(--se-border);color:var(--se-muted);font-size:11px;text-transform:uppercase;letter-spacing:.03em;background:var(--se-head);flex:0 0 auto;}
.se-scroll{flex:1 1 auto;overflow-y:auto;position:relative;}
.se-inner{position:relative;width:100%;}
.se-inner:focus{outline:none;}
.se-row{position:absolute;left:0;right:0;height:${ROW_H}px;border-bottom:1px solid var(--se-border);cursor:pointer;box-sizing:border-box;}
.se-row:hover{background:var(--se-head);}
.se-row.sel{background:var(--se-sel);color:var(--se-sel-fg);}
/* Keyboard focus: ring the selected cue when the list itself is focused. */
.se-inner:focus-visible .se-row.sel{box-shadow:inset 0 0 0 2px var(--se-accent);}
.se-row.playing{box-shadow:inset 3px 0 0 var(--se-accent);}
.se-row.primary .se-num{color:var(--se-accent);font-weight:600;}
.se-row.commented .se-text{opacity:.5;font-style:italic;}
.se-row.commented .se-num::after{content:" ⊘";color:var(--se-muted);}
.se-cell{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.se-num{color:var(--se-muted);}
.se-time{font-variant-numeric:tabular-nums;font-size:12px;}
.se-cps.warn{color:var(--se-warn);}
.se-cps.bad{color:var(--se-bad);font-weight:600;}
.se-text{white-space:pre;overflow:hidden;text-overflow:ellipsis;}
.se-detail{flex:0 0 auto;border-top:1px solid var(--se-border);padding:8px;display:flex;flex-direction:column;gap:6px;background:var(--se-head);}
.se-times{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;}
.se-cpsinfo{margin-left:auto;font-size:11px;color:var(--se-muted);font-variant-numeric:tabular-nums;padding-bottom:4px;white-space:nowrap;}
.se-cpsinfo.warn{color:var(--se-warn);}
.se-cpsinfo.bad{color:var(--se-bad);font-weight:600;}
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
.se-tabs{display:flex;gap:4px;border-bottom:1px solid var(--se-border);}
.se-tab{font:inherit;padding:4px 12px;border:1px solid transparent;border-bottom:none;border-radius:5px 5px 0 0;background:none;color:var(--se-muted);cursor:pointer;}
.se-tab.on{background:var(--se-bg);color:var(--se-fg);border-color:var(--se-border);}
.se-inlinebar{display:flex;gap:5px;align-items:center;flex-wrap:wrap;}
.se-cgroup{display:flex;align-items:center;gap:4px;padding:2px 6px;border:1px solid var(--se-border);border-radius:6px;}
.se-cglabel{color:var(--se-muted);font-size:11px;}
.se-widthfield{width:44px;font:inherit;padding:2px 4px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);}
.se-alpha{width:54px;}
.se-fontname{width:96px;font:inherit;padding:2px 4px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);}
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
.se-cliprect{position:absolute;border:1px dashed #fff;background:rgba(255,255,255,0.12);box-shadow:0 0 0 9999px rgba(0,0,0,0.35);pointer-events:none;}
.se-posbar{position:absolute;top:8px;right:8px;display:flex;gap:8px;z-index:1;}
.se-drawcanvas{position:absolute;inset:0;pointer-events:none;}
.se-obtn{cursor:pointer;font:600 12px system-ui;padding:4px 10px;border:1px solid var(--se-border);border-radius:6px;background:var(--se-head);color:var(--se-fg);}
.se-obtn.on,.se-obtn-primary{background:var(--se-accent);border-color:var(--se-accent);color:#fff;}
.se-fadepop{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;padding:6px;border:1px solid var(--se-border);border-radius:6px;background:var(--se-bg);}
.se-fadepop input{width:70px;}
.se-xgroup{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end;padding:4px 8px;border:1px solid var(--se-border);border-radius:6px;}
.se-xgroup .se-xglabel{flex-basis:100%;color:var(--se-muted);font-size:11px;}
.se-xform input{width:56px;}
.se-empty,.se-noprev{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;text-align:center;padding:24px;color:var(--se-muted);}
.se-empty h3{margin:0;color:var(--se-fg);font-size:15px;}
.se-playerhost{flex:1 1 auto;min-height:0;width:100%;height:100%;}
.se-timeline-wrap{flex:0 0 auto;border-top:1px solid var(--se-border);background:var(--se-head);position:relative;}
.se-timeline{touch-action:none;cursor:grab;}
.se-wave-status{position:absolute;top:20px;left:10px;z-index:1;font-size:11px;color:var(--se-muted);pointer-events:none;}
/* --- polish --- */
/* Smooth hover/selection transitions. */
.se-btn,.se-iconbtn,.se-row,.se-tab,.se-inbtn,.se-obtn,.se-job-btn,.se-track,.se-track-x,.se-track-add{transition:background-color .12s ease,border-color .12s ease,color .12s ease,box-shadow .12s ease;}
/* One consistent keyboard-focus ring for every interactive control. Mouse clicks don't show
   it (:focus-visible); the cue list opts out and rings its active row instead. */
.se-root :focus-visible{outline:2px solid var(--se-accent);outline-offset:1px;}
.se-inner:focus-visible{outline:none;}
.se-iconbtn:focus-visible,.se-btn:focus-visible{border-radius:6px;}
/* Slim, theme-aware scrollbar for the cue list. */
.se-scroll{scrollbar-width:thin;scrollbar-color:var(--se-border) transparent;}
.se-scroll::-webkit-scrollbar{width:11px;}
.se-scroll::-webkit-scrollbar-thumb{background:var(--se-border);border-radius:6px;border:3px solid var(--se-bg);}
.se-scroll::-webkit-scrollbar-thumb:hover{background:var(--se-muted);}
/* Non-blocking toast, bottom-center, auto-dismissed (no longer hijacks the cue count). */
.se-toast{position:absolute;left:50%;bottom:18px;transform:translate(-50%,10px);z-index:30;max-width:82%;padding:8px 14px;border-radius:8px;background:var(--se-fg);color:var(--se-bg);font-size:12px;line-height:1.35;box-shadow:0 6px 20px rgba(0,0,0,.28);opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease;}
.se-toast.on{opacity:.96;transform:translate(-50%,0);}
/* Find / replace bar. */
.se-findbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:6px 8px;border-bottom:1px solid var(--se-border);background:var(--se-head);flex-shrink:0;}
.se-findinput{font:inherit;padding:4px 8px;border:1px solid var(--se-border);border-radius:6px;background:var(--se-bg);color:var(--se-fg);min-width:140px;}
.se-findcount{font-size:12px;color:var(--se-muted);font-variant-numeric:tabular-nums;min-width:64px;}
/* Problems panel: floating, top-right of the editor. */
.se-problems{position:absolute;top:8px;right:8px;z-index:25;width:280px;max-height:60%;overflow-y:auto;background:var(--se-bg);border:1px solid var(--se-border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.28);padding:4px;}
.se-prob-empty{padding:14px;text-align:center;color:var(--se-muted);font-size:12px;}
.se-prob-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px 8px;border-bottom:1px solid var(--se-border);margin-bottom:4px;font-size:12px;color:var(--se-muted);}
.se-prob-row{display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:12px;}
.se-prob-row:hover,.se-prob-row:focus-visible{background:var(--se-head);outline:none;}
.se-prob-idx{color:var(--se-muted);font-variant-numeric:tabular-nums;min-width:22px;text-align:right;}
.se-prob-msg{color:var(--se-warn);}
/* Narrow screens (phones, split panes): stack the preview under the list+detail instead of
   side-by-side, and drop the duration/CPS/actor columns so the text column stays usable. */
@media (max-width: 680px){
.se-body{flex-direction:column;}
.se-left{flex:1 1 auto;min-height:0;border-right:none;border-bottom:1px solid var(--se-border);}
.se-right{flex:0 0 38vh;min-height:150px;}
.se-listhead,.se-row,.se-ass .se-listhead,.se-ass .se-row{grid-template-columns:34px 88px 88px 1fr;}
.se-dur,.se-cps,.se-actor{display:none;}
.se-times{gap:6px;}
.se-field input{width:82px;}
.se-detail{max-height:42vh;overflow-y:auto;}
.se-detail textarea{min-height:44px;}
.se-problems{width:auto;left:8px;right:8px;}
}
@media (prefers-color-scheme: dark){
.se-root{--se-bg:#1c1d21;--se-fg:#e6e7ea;--se-muted:#9aa0aa;--se-border:#33353b;--se-sel:#1e3a5f;--se-sel-fg:#eaf2ff;--se-head:#25272c;--se-warn:#f59e0b;--se-bad:#f87171;--se-accent:#60a5fa;}
}
`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}
