// The ASS style editor: a modal that edits ONE style at a time (the style passed in),
// with room for all the common fields (name, font, size, alignment, fill/secondary/
// outline/back colours, bold/italic/underline/strikeout, outline/shadow width, margins),
// plus Duplicate and Delete. Fields it doesn't surface are preserved on the style object.

import type { AssStyle, SubtitleDoc } from "./cue";
import { assColorToHex, hexToAssColor, makeDefaultStyle, uniqueStyleName, embeddedFontNames } from "./ass";
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
.se-sgroup{flex:1 1 100%;border:1px solid var(--se-border,#33353b);border-radius:8px;padding:10px 12px;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;}
.se-sglabel{flex:1 1 100%;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--se-muted,#9aa0aa);}
.se-scgroup{display:flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid var(--se-border,#33353b);border-radius:7px;}
.se-scglabel{font-size:10px;text-transform:uppercase;letter-spacing:.03em;color:var(--se-muted,#9aa0aa);white-space:nowrap;}
.se-scgroup .se-alpha{width:56px;}
.se-scgroup .se-widthfield{width:52px;font:inherit;padding:4px 6px;border:1px solid var(--se-border,#33353b);border-radius:6px;background:var(--se-head,#25272c);color:var(--se-fg,#e6e7ea);}
.se-scgroup select{width:auto;}
.se-colours,.se-toggles{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;}
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
  // A colour with its opacity slider, plus any extras (width field, border-style select),
  // boxed under one label. Colour + alpha both write the field as &HAABBGGRR.
  const COLOUR_TIP: Record<string, string> = {
    PrimaryColour: t("tipColorFill"),
    SecondaryColour: t("tipColorSecondary"),
    OutlineColour: t("tipColorBorder"),
    BackColour: t("tipColorBack"),
  };
  const colourBox = (label: string, field: string, ...extras: HTMLElement[]): HTMLElement => {
    const box = document.createElement("div");
    box.className = "se-scgroup";
    const lbl = document.createElement("span");
    lbl.className = "se-scglabel";
    lbl.textContent = label;
    box.appendChild(lbl);
    let { hex, alpha } = assColorToHex(style.fields[field] ?? "&H00FFFFFF");
    const write = () => {
      style.fields[field] = hexToAssColor(hex, alpha);
      host.onChange();
    };
    const colour = document.createElement("input");
    colour.type = "color";
    colour.value = hex;
    colour.title = COLOUR_TIP[field] ?? label;
    colour.addEventListener("input", () => {
      hex = colour.value;
      write();
    });
    const opa = document.createElement("input");
    opa.type = "range";
    opa.className = "se-alpha";
    opa.min = "0";
    opa.max = "100";
    opa.value = String(Math.round((1 - parseInt(alpha || "00", 16) / 255) * 100));
    opa.title = t("tipOpacity");
    opa.addEventListener("input", () => {
      alpha = Math.round((1 - Number(opa.value) / 100) * 255).toString(16).padStart(2, "0").toUpperCase();
      write();
    });
    box.append(colour, opa, ...extras);
    return box;
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

  // Labeled groups, mirroring the main interface's grouping.
  const group = (title: string): HTMLElement => {
    const g = document.createElement("div");
    g.className = "se-sgroup";
    const lab = document.createElement("span");
    lab.className = "se-sglabel";
    lab.textContent = title;
    g.appendChild(lab);
    body.appendChild(g);
    return g;
  };
  const gGeneral = group(t("sgGeneral"));
  const gColours = group(t("sgColours"));
  const gTransform = group(t("sgTransform"));
  const gMargins = group(t("sgMargins"));

  // Name.
  gGeneral.appendChild(
    textField(t("styleName"), "se-f-name", style.name, (v) => {
      const from = style.name;
      const to = v.trim() || from;
      style.name = to;
      if (from !== to) host.onRenameStyle(from, to);
      setTitle();
      host.onChange();
    }),
  );
  // Font (with a datalist of fonts used in this file) + size.
  const fontWrap = document.createElement("label");
  fontWrap.className = "se-f-font";
  fontWrap.textContent = t("styleFont");
  const fontInput = document.createElement("input");
  fontInput.type = "text";
  fontInput.value = style.fields.Fontname ?? "";
  fontInput.setAttribute("list", "se-fontlist");
  fontInput.addEventListener("change", () => {
    style.fields.Fontname = fontInput.value;
    host.onChange();
  });
  const datalist = document.createElement("datalist");
  datalist.id = "se-fontlist";
  const fonts = new Set<string>();
  for (const s of doc.styles ?? []) if (s.fields.Fontname) fonts.add(s.fields.Fontname);
  for (const f of embeddedFontNames(doc)) fonts.add(f);
  for (const f of ["Arial", "Helvetica", "Times New Roman", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Courier New", "Comic Sans MS"]) fonts.add(f);
  for (const f of fonts) {
    const o = document.createElement("option");
    o.value = f;
    datalist.appendChild(o);
  }
  fontWrap.append(fontInput, datalist);
  gGeneral.appendChild(fontWrap);
  gGeneral.appendChild(
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
  const updateMarginV = (): void => {
    // MarginV is ignored for middle-row alignment (4/5/6): hide it there.
    marginVWrap.style.display = ["4", "5", "6"].includes(alignSel.value) ? "none" : "";
  };
  alignSel.addEventListener("change", () => {
    style.fields.Alignment = alignSel.value;
    updateMarginV();
    host.onChange();
  });
  alignWrap.appendChild(alignSel);
  gGeneral.appendChild(alignWrap);

  // Encoding (font charset), as a dropdown of the common Windows charset IDs.
  const encWrap = document.createElement("label");
  encWrap.className = "se-f-align";
  encWrap.textContent = t("styleEncoding");
  const encSel = document.createElement("select");
  // The Win32 LOGFONT charset IDs (fdwCharSet), same set VSFilter uses. Not a text
  // encoding, so there is no UTF-8 here; the file text is UTF-8 independently.
  const charsets: [string, string][] = [
    ["1", "Default"],
    ["0", "ANSI (Western European)"],
    ["77", "Mac"],
    ["128", "Japanese (Shift-JIS)"],
    ["129", "Korean (Hangul)"],
    ["130", "Korean (Johab)"],
    ["134", "Simplified Chinese (GB2312)"],
    ["136", "Traditional Chinese (Big5)"],
    ["161", "Greek"],
    ["162", "Turkish"],
    ["163", "Vietnamese"],
    ["177", "Hebrew"],
    ["178", "Arabic"],
    ["186", "Baltic"],
    ["204", "Russian (Cyrillic)"],
    ["222", "Thai"],
    ["238", "Eastern European"],
    ["255", "OEM"],
  ];
  const current = style.fields.Encoding ?? "1";
  if (!charsets.some(([v]) => v === current)) charsets.push([current, current]); // keep an unknown value intact
  for (const [v, lbl] of charsets) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v === lbl ? v : `${v} (${lbl})`;
    encSel.appendChild(o);
  }
  encSel.value = current;
  encSel.addEventListener("change", () => {
    style.fields.Encoding = encSel.value;
    host.onChange();
  });
  encWrap.appendChild(encSel);
  gGeneral.appendChild(encWrap);

  // Border-style selector (outline vs opaque box): a STYLE-level property (no inline tag).
  const borderSel = document.createElement("select");
  for (const [v, lbl] of [
    ["1", t("borderOutline")],
    ["3", t("borderBox")],
  ]) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = lbl;
    borderSel.appendChild(o);
  }
  borderSel.value = style.fields.BorderStyle ?? "1";
  borderSel.title = t("tipBorderStyle");
  borderSel.addEventListener("change", () => {
    style.fields.BorderStyle = borderSel.value;
    host.onChange();
  });
  const widthField = (field: string): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "number";
    input.className = "se-widthfield";
    input.min = "0";
    input.step = "0.5";
    input.title = field === "Shadow" ? t("tipShadowWidthField") : t("tipBorderWidthField");
    input.value = style.fields[field] ?? "";
    input.addEventListener("change", () => {
      style.fields[field] = input.value;
      host.onChange();
    });
    return input;
  };

  // Colour boxes: each colour with opacity; border also carries its width + type, shadow
  // its width. Mirrors the main interface's grouped colour controls.
  gColours.append(
    colourBox(t("stylePrimary"), "PrimaryColour"),
    colourBox(t("styleSecondary"), "SecondaryColour"),
    colourBox(t("styleOutline"), "OutlineColour", widthField("Outline"), borderSel),
    colourBox(t("styleBack"), "BackColour", widthField("Shadow")),
  );
  const toggles = document.createElement("div");
  toggles.className = "se-toggles";
  toggles.append(
    toggleBtn("B", "Bold", "se-t-b"),
    toggleBtn("I", "Italic", "se-t-i"),
    toggleBtn("U", "Underline", "se-t-u"),
    toggleBtn("S", "StrikeOut", "se-t-s"),
  );
  gColours.appendChild(toggles);

  // Scale / spacing / rotation.
  for (const [label, field] of [
    [t("styleScaleX"), "ScaleX"],
    [t("styleScaleY"), "ScaleY"],
    [t("styleSpacing"), "Spacing"],
    [t("styleAngle"), "Angle"],
  ] as const) {
    gTransform.appendChild(
      numField(label, "se-f-margin", style.fields[field] ?? "", (v) => {
        style.fields[field] = v;
        host.onChange();
      }),
    );
  }

  // Margins.
  gMargins.append(
    numField(t("marginL"), "se-f-margin", style.fields.MarginL ?? "", (v) => {
      style.fields.MarginL = v;
      host.onChange();
    }),
    numField(t("marginR"), "se-f-margin", style.fields.MarginR ?? "", (v) => {
      style.fields.MarginR = v;
      host.onChange();
    }),
  );
  const marginVWrap = numField(t("marginV"), "se-f-margin", style.fields.MarginV ?? "", (v) => {
    style.fields.MarginV = v;
    host.onChange();
  });
  gMargins.appendChild(marginVWrap);
  updateMarginV();

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

// --- Script properties (Script Info fields) ------------------------------------------

function getScriptField(info: string, key: string): string {
  return info.match(new RegExp(`^\\s*${key}\\s*:\\s*(.*)$`, "im"))?.[1]?.trim() ?? "";
}
function setScriptField(info: string, key: string, value: string, eol: string): string {
  const re = new RegExp(`^(\\s*${key}\\s*:).*$`, "im");
  if (re.test(info)) return info.replace(re, `$1 ${value}`);
  // Insert after the [Script Info] header (or at the top).
  const lines = info.split(/\r?\n/);
  const at = lines.findIndex((l) => /^\[script info\]/i.test(l.trim()));
  lines.splice(at >= 0 ? at + 1 : 0, 0, `${key}: ${value}`);
  return lines.join(eol);
}

export function openScriptProperties(host: { getDoc(): SubtitleDoc; onChange(): void }): void {
  injectStylesCss();
  const doc = host.getDoc();

  const back = document.createElement("div");
  back.className = "se-modal-back";
  const modal = document.createElement("div");
  modal.className = "se-modal";
  back.appendChild(modal);
  const head = document.createElement("div");
  head.className = "se-modal-head";
  const h3 = document.createElement("h3");
  h3.textContent = t("scriptProps");
  const closeBtn = document.createElement("button");
  closeBtn.className = "se-btnp";
  closeBtn.textContent = t("close");
  head.append(h3, closeBtn);
  const body = document.createElement("div");
  body.className = "se-modal-body";
  modal.append(head, body);
  document.body.appendChild(back);
  const close = () => back.remove();
  closeBtn.addEventListener("click", close);
  back.addEventListener("click", (e) => {
    if (e.target === back) close();
  });

  const set = (key: string, value: string) => {
    doc.assScriptInfo = setScriptField(doc.assScriptInfo ?? "[Script Info]", key, value, doc.eol);
    host.onChange();
  };
  const info = () => doc.assScriptInfo ?? "";

  const textField = (label: string, cls: string, key: string): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.className = cls;
    wrap.textContent = label;
    const input = document.createElement("input");
    input.type = cls === "se-f-size" ? "number" : "text";
    input.value = getScriptField(info(), key);
    input.addEventListener("change", () => set(key, input.value));
    wrap.appendChild(input);
    return wrap;
  };
  const selectField = (label: string, key: string, opts: [string, string][], fallback: string): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.className = "se-f-align";
    wrap.textContent = label;
    const sel = document.createElement("select");
    for (const [v, lbl] of opts) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = lbl;
      sel.appendChild(o);
    }
    sel.value = getScriptField(info(), key) || fallback;
    sel.addEventListener("change", () => set(key, sel.value));
    wrap.appendChild(sel);
    return wrap;
  };

  body.append(
    textField(t("scriptTitle"), "se-f-name", "Title"),
    textField(t("playResX"), "se-f-size", "PlayResX"),
    textField(t("playResY"), "se-f-size", "PlayResY"),
    selectField(t("wrapStyle"), "WrapStyle", [["0", "0"], ["1", "1"], ["2", "2"], ["3", "3"]], "0"),
    selectField(t("scaledBorder"), "ScaledBorderAndShadow", [["yes", "yes"], ["no", "no"]], "yes"),
  );
}

// Re-exported so hosts can build a style and open its editor.
export { makeDefaultStyle, uniqueStyleName };
