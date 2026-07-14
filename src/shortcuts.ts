// Keyboard shortcuts. Each is shown in its button's tooltip and matched in the editor's
// onKeydown. The label is what the tooltip shows (Mac uses the command symbol, other
// platforms spell the modifiers); `aria` is the ARIA key-name form for aria-keyshortcuts so
// assistive tech can announce it. Navigation (arrows) and play/pause (space) are inline.

export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl"; // ⌘ / Ctrl
const SHIFT_LABEL = IS_MAC ? "⇧" : "Shift"; // ⇧ / Shift
const comboLabel = (...parts: string[]): string => (IS_MAC ? parts.join("") : parts.join("+"));
const hasMod = (e: KeyboardEvent): boolean => e.ctrlKey || e.metaKey;

export interface Shortcut {
  label: string; // shown in the tooltip, e.g. "⌘S" or "Ctrl+S"
  aria: string; // ARIA key names for aria-keyshortcuts, e.g. "Control+S"
  match: (e: KeyboardEvent) => boolean;
}

export const SHORTCUTS: Record<
  | "addCue"
  | "removeCue"
  | "save"
  | "saveVideo"
  | "undo"
  | "redo"
  | "find"
  | "markIn"
  | "markOut"
  | "playCue"
  | "duplicate"
  | "copy"
  | "paste",
  Shortcut
> = {
  duplicate: {
    label: comboLabel(MOD_LABEL, "D"),
    aria: IS_MAC ? "Meta+D" : "Control+D",
    match: (e) => hasMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d",
  },
  copy: {
    label: comboLabel(MOD_LABEL, "C"),
    aria: IS_MAC ? "Meta+C" : "Control+C",
    match: (e) => hasMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "c",
  },
  paste: {
    label: comboLabel(MOD_LABEL, "V"),
    aria: IS_MAC ? "Meta+V" : "Control+V",
    match: (e) => hasMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "v",
  },
  find: {
    label: comboLabel(MOD_LABEL, "F"),
    aria: IS_MAC ? "Meta+F" : "Control+F",
    match: (e) => hasMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f",
  },
  markIn: { label: "[", aria: "[", match: (e) => e.key === "[" && !hasMod(e) && !e.altKey },
  markOut: { label: "]", aria: "]", match: (e) => e.key === "]" && !hasMod(e) && !e.altKey },
  playCue: { label: "\\", aria: "\\", match: (e) => e.key === "\\" && !hasMod(e) && !e.altKey },
  undo: {
    label: comboLabel(MOD_LABEL, "Z"),
    aria: IS_MAC ? "Meta+Z" : "Control+Z",
    match: (e) => hasMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z",
  },
  redo: {
    // Ctrl/Cmd+Shift+Z everywhere; also accept Ctrl+Y on Windows/Linux where it's conventional.
    label: comboLabel(MOD_LABEL, SHIFT_LABEL, "Z"),
    aria: IS_MAC ? "Meta+Shift+Z" : "Control+Shift+Z Control+Y",
    match: (e) =>
      hasMod(e) && !e.altKey && ((e.shiftKey && e.key.toLowerCase() === "z") || (!e.shiftKey && !IS_MAC && e.key.toLowerCase() === "y")),
  },
  // Insert has no key on most Macs, so accept Cmd/Ctrl+Enter too and show the fitting label.
  addCue: {
    label: IS_MAC ? comboLabel(MOD_LABEL, "↩") : "Insert", // ⌘↩ on Mac, Insert elsewhere
    aria: IS_MAC ? "Meta+Enter" : "Insert",
    match: (e) =>
      (e.key === "Insert" && !hasMod(e) && !e.altKey) || (hasMod(e) && !e.shiftKey && !e.altKey && e.key === "Enter"),
  },
  // Delete on Windows/Linux; on a Mac the "delete" key reports Backspace, so accept both.
  removeCue: {
    label: "Delete",
    aria: IS_MAC ? "Backspace" : "Delete",
    match: (e) => (e.key === "Delete" || e.key === "Backspace") && !hasMod(e) && !e.altKey,
  },
  save: {
    label: comboLabel(MOD_LABEL, "S"),
    aria: IS_MAC ? "Meta+S" : "Control+S",
    match: (e) => hasMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s",
  },
  saveVideo: {
    label: comboLabel(MOD_LABEL, SHIFT_LABEL, "S"),
    aria: IS_MAC ? "Meta+Shift+S" : "Control+Shift+S",
    match: (e) => hasMod(e) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "s",
  },
};
