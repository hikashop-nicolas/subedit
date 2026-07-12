// The ASS styles editor: a modal listing the document's styles with editable fields
// (name, font, size, primary/outline colour, bold/italic/underline, alignment, margins)
// and add / duplicate / delete actions. Fields it doesn't surface are preserved on the
// style object. Mutating a style calls onChange so the host re-serializes and refreshes.

import type { AssStyle, SubtitleDoc } from "./cue";
import { assColorToHex, hexToAssColor, makeDefaultStyle } from "./ass";
import { t } from "./i18n";

export interface StylesEditorHost {
  getDoc(): SubtitleDoc;
  onChange(): void; // a style was added/edited/removed
  onRenameStyle(from: string, to: string): void; // update cues referencing the style
}

let stylesCssInjected = false;
function injectStylesCss(): void {
  if (stylesCssInjected) return;
  stylesCssInjected = true;
  const css = `
.se-modal-back{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;}
.se-modal{background:var(--se-bg,#1c1d21);color:var(--se-fg,#e6e7ea);border:1px solid var(--se-border,#33353b);border-radius:10px;
  width:min(880px,94vw);max-height:88vh;display:flex;flex-direction:column;font-family:system-ui,sans-serif;font-size:13px;}
.se-modal-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--se-border,#33353b);}
.se-modal-head h3{margin:0;font-size:14px;flex:1 1 auto;}
.se-modal-body{overflow:auto;padding:8px 14px;}
.se-style-row{display:grid;grid-template-columns:1.4fr 1.2fr 56px 44px 44px auto;gap:8px;align-items:center;
  padding:8px 0;border-bottom:1px solid var(--se-border,#33353b);}
.se-style-row .se-swatches{display:flex;gap:6px;align-items:center;}
.se-style-row label{display:flex;flex-direction:column;gap:2px;font-size:10px;color:var(--se-muted,#9aa0aa);text-transform:uppercase;letter-spacing:.03em;}
.se-style-row input[type=text],.se-style-row input[type=number],.se-style-row select{
  font:inherit;padding:3px 5px;border:1px solid var(--se-border,#33353b);border-radius:5px;background:var(--se-head,#25272c);color:var(--se-fg,#e6e7ea);width:100%;box-sizing:border-box;}
.se-style-row input[type=color]{width:26px;height:22px;padding:0;border:1px solid var(--se-border,#33353b);border-radius:4px;background:none;cursor:pointer;}
.se-style-toggles{display:flex;gap:6px;align-items:center;}
.se-style-toggles button{font:600 12px system-ui;width:24px;height:24px;border:1px solid var(--se-border,#33353b);border-radius:5px;background:var(--se-head,#25272c);color:var(--se-fg,#e6e7ea);cursor:pointer;}
.se-style-toggles button.on{background:var(--se-accent,#2563eb);border-color:var(--se-accent,#2563eb);color:#fff;}
.se-style-actions{display:flex;gap:4px;}
.se-style-actions button{font:inherit;padding:3px 7px;border:1px solid var(--se-border,#33353b);border-radius:5px;background:var(--se-head,#25272c);color:var(--se-fg,#e6e7ea);cursor:pointer;}
.se-style-actions button:hover{border-color:var(--se-accent,#2563eb);}
.se-modal-foot{padding:10px 14px;border-top:1px solid var(--se-border,#33353b);display:flex;gap:8px;}
.se-modal .se-btnp{font:inherit;padding:5px 12px;border:1px solid var(--se-border,#33353b);border-radius:6px;background:var(--se-head,#25272c);color:var(--se-fg,#e6e7ea);cursor:pointer;}
.se-modal .se-btnp:hover{border-color:var(--se-accent,#2563eb);}
`;
  const s = document.createElement("style");
  s.textContent = css;
  document.head.appendChild(s);
}

const ALIGN_LABELS: Record<string, string> = {
  "7": "↖", "8": "↑", "9": "↗", "4": "←", "5": "•", "6": "→", "1": "↙", "2": "↓", "3": "↘",
};

export function openStylesEditor(host: StylesEditorHost): void {
  injectStylesCss();
  const doc = host.getDoc();
  doc.styles ??= [];

  const back = document.createElement("div");
  back.className = "se-modal-back";
  const modal = document.createElement("div");
  modal.className = "se-modal";
  back.appendChild(modal);

  const head = document.createElement("div");
  head.className = "se-modal-head";
  const h3 = document.createElement("h3");
  h3.textContent = t("stylesEditor");
  const closeBtn = document.createElement("button");
  closeBtn.className = "se-btnp";
  closeBtn.textContent = t("close");
  head.append(h3, closeBtn);

  const body = document.createElement("div");
  body.className = "se-modal-body";

  const foot = document.createElement("div");
  foot.className = "se-modal-foot";
  const addBtn = document.createElement("button");
  addBtn.className = "se-btnp";
  addBtn.textContent = t("addStyle");
  foot.appendChild(addBtn);

  modal.append(head, body, foot);
  document.body.appendChild(back);

  const close = (): void => back.remove();
  closeBtn.addEventListener("click", close);
  back.addEventListener("click", (e) => {
    if (e.target === back) close();
  });

  const rebuild = (): void => {
    body.textContent = "";
    doc.styles!.forEach((style, i) => body.appendChild(renderRow(style, i)));
  };

  const numField = (label: string, value: string, onCommit: (v: string) => void): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.value = value;
    input.addEventListener("change", () => onCommit(input.value));
    wrap.appendChild(input);
    return wrap;
  };

  const colourSwatch = (label: string, field: string, style: AssStyle): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.textContent = label;
    const { hex, alpha } = assColorToHex(style.fields[field] ?? "&H00FFFFFF");
    const input = document.createElement("input");
    input.type = "color";
    input.value = hex;
    input.addEventListener("input", () => {
      style.fields[field] = hexToAssColor(input.value, alpha);
      host.onChange();
    });
    wrap.appendChild(input);
    return wrap;
  };

  const toggle = (labelChar: string, field: string, style: AssStyle): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = labelChar;
    const on = () => (style.fields[field] ?? "0") !== "0";
    b.classList.toggle("on", on());
    b.addEventListener("click", () => {
      style.fields[field] = on() ? "0" : "-1"; // ASS booleans: -1 = true, 0 = false
      b.classList.toggle("on", on());
      host.onChange();
    });
    return b;
  };

  function renderRow(style: AssStyle, index: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "se-style-row";

    // Name.
    const nameWrap = document.createElement("label");
    nameWrap.textContent = t("styleName");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = style.name;
    nameInput.addEventListener("change", () => {
      const from = style.name;
      const to = nameInput.value.trim() || from;
      style.name = to;
      if (from !== to) host.onRenameStyle(from, to);
      host.onChange();
    });
    nameWrap.appendChild(nameInput);

    // Font.
    const fontWrap = document.createElement("label");
    fontWrap.textContent = t("styleFont");
    const fontInput = document.createElement("input");
    fontInput.type = "text";
    fontInput.value = style.fields.Fontname ?? "";
    fontInput.addEventListener("change", () => {
      style.fields.Fontname = fontInput.value;
      host.onChange();
    });
    fontWrap.appendChild(fontInput);

    const sizeWrap = numField(t("styleSize"), style.fields.Fontsize ?? "", (v) => {
      style.fields.Fontsize = v;
      host.onChange();
    });

    // Colours.
    const swatches = document.createElement("div");
    swatches.className = "se-swatches";
    swatches.append(colourSwatch(t("stylePrimary"), "PrimaryColour", style), colourSwatch(t("styleOutline"), "OutlineColour", style));

    // Toggles.
    const toggles = document.createElement("div");
    toggles.className = "se-style-toggles";
    toggles.append(toggle("B", "Bold", style), toggle("I", "Italic", style), toggle("U", "Underline", style));

    // Alignment.
    const alignWrap = document.createElement("label");
    alignWrap.textContent = t("styleAlign");
    const alignSel = document.createElement("select");
    for (const a of ["7", "8", "9", "4", "5", "6", "1", "2", "3"]) {
      const o = document.createElement("option");
      o.value = a;
      o.textContent = `${a} ${ALIGN_LABELS[a]}`;
      alignSel.appendChild(o);
    }
    alignSel.value = style.fields.Alignment ?? "2";
    alignSel.addEventListener("change", () => {
      style.fields.Alignment = alignSel.value;
      host.onChange();
    });
    alignWrap.appendChild(alignSel);

    // Actions.
    const actions = document.createElement("div");
    actions.className = "se-style-actions";
    const dup = document.createElement("button");
    dup.textContent = t("duplicate");
    dup.addEventListener("click", () => {
      const copy: AssStyle = { name: uniqueName(style.name + " copy"), fields: { ...style.fields } };
      doc.styles!.splice(index + 1, 0, copy);
      host.onChange();
      rebuild();
    });
    const del = document.createElement("button");
    del.textContent = t("delete");
    del.addEventListener("click", () => {
      doc.styles!.splice(index, 1);
      host.onChange();
      rebuild();
    });
    actions.append(dup, del);

    row.append(nameWrap, fontWrap, sizeWrap, wrapCell(swatches), wrapCell(toggles), alignWrap, actions);
    return row;
  }

  function wrapCell(inner: HTMLElement): HTMLElement {
    const l = document.createElement("label");
    l.textContent = " ";
    l.appendChild(inner);
    return l;
  }

  function uniqueName(base: string): string {
    const names = new Set(doc.styles!.map((s) => s.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} ${n}`)) n += 1;
    return `${base} ${n}`;
  }

  addBtn.addEventListener("click", () => {
    doc.styles!.push(makeDefaultStyle(uniqueName("New style")));
    host.onChange();
    rebuild();
  });

  rebuild();
}
