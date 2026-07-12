// The ASS style editor: a modal that edits ONE style at a time (the style passed in),
// with room for all the common fields (name, font, size, alignment, fill/secondary/
// outline/back colours, bold/italic/underline/strikeout, outline/shadow width, margins),
// plus Duplicate and Delete. Fields it doesn't surface are preserved on the style object.

import type { AssStyle, SubtitleDoc } from "./cue";
import { assColorToHex, hexToAssColor, makeDefaultStyle, uniqueStyleName } from "./ass";
import { t, alignmentOptions } from "./i18n";

export interface StylesEditorHost {
  getDoc(): SubtitleDoc;
  onChange(): void; // the style was edited/added/removed
  onRenameStyle(from: string, to: string): void; // update cues referencing the style
}

let stylesCssInjected = false;
function injectStylesCss(): void {
  if (stylesCssInjected) return;
  stylesCssInjected = true;
  const css = `
.se-modal-back{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;}
.se-modal{background:var(--se-bg,#1c1d21);color:var(--se-fg,#e6e7ea);border:1px solid var(--se-border,#33353b);border-radius:10px;
  width:min(560px,94vw);max-height:88vh;display:flex;flex-direction:column;font-family:system-ui,sans-serif;font-size:13px;}
.se-modal-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--se-border,#33353b);}
.se-modal-head h3{margin:0;font-size:14px;flex:1 1 auto;}
.se-modal-body{overflow:auto;padding:14px;display:flex;flex-wrap:wrap;gap:14px;}
.se-modal-body label{display:flex;flex-direction:column;gap:4px;font-size:10px;color:var(--se-muted,#9aa0aa);
  text-transform:uppercase;letter-spacing:.03em;white-space:nowrap;}
.se-modal-body .se-f-name{flex:1 1 100%;}
.se-modal-body .se-f-font{flex:1 1 200px;}
.se-modal-body .se-f-size{flex:0 0 80px;}
.se-modal-body .se-f-align{flex:0 0 160px;}
.se-modal-body .se-f-margin{flex:0 0 72px;}
.se-modal-body input[type=text],.se-modal-body input[type=number],.se-modal-body select{
  font:inherit;padding:5px 7px;border:1px solid var(--se-border,#33353b);border-radius:6px;
  background:var(--se-head,#25272c);color:var(--se-fg,#e6e7ea);width:100%;box-sizing:border-box;}
.se-modal-body input[type=color]{width:40px;height:28px;padding:0;border:1px solid var(--se-border,#33353b);border-radius:6px;background:none;cursor:pointer;}
.se-colours,.se-toggles{display:flex;gap:10px;flex:1 1 100%;flex-wrap:wrap;}
.se-toggles button{font:600 13px system-ui;width:34px;height:30px;border:1px solid var(--se-border,#33353b);border-radius:6px;background:var(--se-head,#25272c);color:var(--se-fg,#e6e7ea);cursor:pointer;}
.se-toggles button.on{background:var(--se-accent,#2563eb);border-color:var(--se-accent,#2563eb);color:#fff;}
.se-toggles .se-t-i{font-style:italic;} .se-toggles .se-t-u{text-decoration:underline;} .se-toggles .se-t-s{text-decoration:line-through;}
.se-modal-foot{padding:10px 14px;border-top:1px solid var(--se-border,#33353b);display:flex;gap:8px;align-items:center;}
.se-modal-foot .se-spacer{flex:1 1 auto;}
.se-modal .se-btnp{font:inherit;padding:6px 13px;border:1px solid var(--se-border,#33353b);border-radius:6px;background:var(--se-head,#25272c);color:var(--se-fg,#e6e7ea);cursor:pointer;}
.se-modal .se-btnp:hover{border-color:var(--se-accent,#2563eb);}
.se-modal .se-btnp.danger:hover{border-color:#e5484d;color:#e5484d;}
`;
  const s = document.createElement("style");
  s.textContent = css;
  document.head.appendChild(s);
}

export function openStyleEditor(host: StylesEditorHost, style: AssStyle): void {
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
  const closeBtn = document.createElement("button");
  closeBtn.className = "se-btnp";
  closeBtn.textContent = t("close");
  head.append(h3, closeBtn);

  const body = document.createElement("div");
  body.className = "se-modal-body";

  const foot = document.createElement("div");
  foot.className = "se-modal-foot";
  const dupBtn = document.createElement("button");
  dupBtn.className = "se-btnp";
  dupBtn.textContent = t("duplicate");
  const delBtn = document.createElement("button");
  delBtn.className = "se-btnp danger";
  delBtn.textContent = t("delete");
  const spacer = document.createElement("div");
  spacer.className = "se-spacer";
  const doneBtn = document.createElement("button");
  doneBtn.className = "se-btnp";
  doneBtn.textContent = t("close");
  foot.append(dupBtn, delBtn, spacer, doneBtn);

  modal.append(head, body, foot);
  document.body.appendChild(back);

  const close = (): void => back.remove();
  closeBtn.addEventListener("click", close);
  doneBtn.addEventListener("click", close);
  back.addEventListener("click", (e) => {
    if (e.target === back) close();
  });

  const textField = (label: string, cls: string, value: string, onCommit: (v: string) => void): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.className = cls;
    wrap.textContent = label;
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.addEventListener("change", () => onCommit(input.value));
    wrap.appendChild(input);
    return wrap;
  };
  const numField = (label: string, cls: string, value: string, onCommit: (v: string) => void): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.className = cls;
    wrap.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.value = value;
    input.addEventListener("change", () => onCommit(input.value));
    wrap.appendChild(input);
    return wrap;
  };
  const colourField = (label: string, field: string): HTMLElement => {
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
  const toggleBtn = (label: string, field: string, cls: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    const on = () => (style.fields[field] ?? "0") !== "0";
    b.classList.toggle("on", on());
    b.addEventListener("click", () => {
      style.fields[field] = on() ? "0" : "-1"; // ASS booleans: -1 true, 0 false
      b.classList.toggle("on", on());
      host.onChange();
    });
    return b;
  };

  const setTitle = (): void => {
    h3.textContent = `${t("stylesEditor")}: ${style.name}`;
  };
  setTitle();

  // Name.
  body.appendChild(
    textField(t("styleName"), "se-f-name", style.name, (v) => {
      const from = style.name;
      const to = v.trim() || from;
      style.name = to;
      if (from !== to) host.onRenameStyle(from, to);
      setTitle();
      host.onChange();
    }),
  );
  // Font + size.
  body.appendChild(
    textField(t("styleFont"), "se-f-font", style.fields.Fontname ?? "", (v) => {
      style.fields.Fontname = v;
      host.onChange();
    }),
  );
  body.appendChild(
    numField(t("styleSize"), "se-f-size", style.fields.Fontsize ?? "", (v) => {
      style.fields.Fontsize = v;
      host.onChange();
    }),
  );
  // Alignment.
  const alignWrap = document.createElement("label");
  alignWrap.className = "se-f-align";
  alignWrap.textContent = t("styleAlign");
  const alignSel = document.createElement("select");
  for (const { value, label } of alignmentOptions()) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    alignSel.appendChild(o);
  }
  alignSel.value = style.fields.Alignment ?? "2";
  alignSel.addEventListener("change", () => {
    style.fields.Alignment = alignSel.value;
    host.onChange();
  });
  alignWrap.appendChild(alignSel);
  body.appendChild(alignWrap);

  // Colours.
  const colours = document.createElement("div");
  colours.className = "se-colours";
  colours.append(
    colourField(t("stylePrimary"), "PrimaryColour"),
    colourField(t("styleSecondary"), "SecondaryColour"),
    colourField(t("styleOutline"), "OutlineColour"),
    colourField(t("styleBack"), "BackColour"),
  );
  body.appendChild(colours);

  // Toggles.
  const toggles = document.createElement("div");
  toggles.className = "se-toggles";
  toggles.append(
    toggleBtn("B", "Bold", "se-t-b"),
    toggleBtn("I", "Italic", "se-t-i"),
    toggleBtn("U", "Underline", "se-t-u"),
    toggleBtn("S", "StrikeOut", "se-t-s"),
  );
  body.appendChild(toggles);

  // Outline / shadow.
  body.appendChild(
    numField(t("styleOutlineW"), "se-f-margin", style.fields.Outline ?? "", (v) => {
      style.fields.Outline = v;
      host.onChange();
    }),
  );
  body.appendChild(
    numField(t("styleShadow"), "se-f-margin", style.fields.Shadow ?? "", (v) => {
      style.fields.Shadow = v;
      host.onChange();
    }),
  );
  // Margins.
  for (const [label, field] of [
    [t("marginL"), "MarginL"],
    [t("marginR"), "MarginR"],
    [t("marginV"), "MarginV"],
  ] as const) {
    body.appendChild(
      numField(label, "se-f-margin", style.fields[field] ?? "", (v) => {
        style.fields[field] = v;
        host.onChange();
      }),
    );
  }

  dupBtn.addEventListener("click", () => {
    const copy: AssStyle = { name: uniqueStyleName(doc, style.name + " copy"), fields: { ...style.fields } };
    const idx = doc.styles!.indexOf(style);
    doc.styles!.splice(idx + 1, 0, copy);
    host.onChange();
    close();
    openStyleEditor(host, copy);
  });
  delBtn.addEventListener("click", () => {
    const idx = doc.styles!.indexOf(style);
    if (idx >= 0) doc.styles!.splice(idx, 1);
    host.onChange();
    close();
  });
}

// Re-exported so hosts can build a style and open its editor.
export { makeDefaultStyle, uniqueStyleName };
