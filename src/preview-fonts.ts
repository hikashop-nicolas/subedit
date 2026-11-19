// Font files for the libass preview. libass only draws with font files it is handed, so the
// faces the document uses are resolved to bytes: the file's own [Fonts] first, then
// fontshelf (installed fonts with the local-fonts permission, catalog fonts after consent).
import { getFontFile, onFontsChange, parseFontInfo, type FontFile } from "fontshelf";
import type { SubtitleDoc } from "./cue";
import { embeddedFonts, fontUsage } from "./formats/ass";

/** Where fonts may come from; mirrors the editor's `fonts` option. */
export interface FontSources {
  local: boolean;
  remote: boolean;
}

export interface PreviewFont {
  name: string;
  data: Uint8Array;
}

export class PreviewFonts {
  // family|weight|italic -> the file fontshelf found (null: none yet).
  private files = new Map<string, Promise<FontFile | null>>();
  private run = 0;
  private timer = 0;
  private last = "";
  private readonly off: () => void;

  constructor(
    private readonly sources: FontSources,
    private readonly getDoc: () => SubtitleDoc,
    private readonly apply: (fonts: PreviewFont[]) => void,
  ) {
    // A granted permission, a consent or an added family may resolve what was missing.
    this.off = onFontsChange(() => {
      for (const [k, p] of this.files) void p.then((f) => { if (!f) this.files.delete(k); });
      this.schedule(50);
    });
  }

  schedule(ms = 400): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.sync(), ms);
  }

  async sync(): Promise<void> {
    const run = ++this.run;
    const doc = this.getDoc();
    if (doc.format !== "ass") return this.send([]);
    const out: PreviewFont[] = [];
    const embedded = new Set<string>();
    for (const f of embeddedFonts(doc)) {
      out.push({ name: `embedded:${f.filename}:${f.bytes.length}`, data: f.bytes });
      if (f.family) embedded.add(f.family.toLowerCase());
      // Every family name in the file, so a style naming the full name is covered too.
      const info = parseFontInfo(f.bytes);
      for (const n of [info?.family, info?.fullName]) if (n) embedded.add(n.toLowerCase());
    }
    const wanted = fontUsage(doc).filter((u) => !embedded.has(u.family.toLowerCase()));
    const files = await Promise.all(wanted.map((u) => this.file(u.family, u.weight, u.italic)));
    if (run !== this.run) return;
    const seen = new Set<string>();
    for (const f of files) {
      if (!f || f.format === "woff" || f.format === "woff2") continue; // engines get sfnt bytes
      const key = `${f.source}:${f.postscriptName ?? f.family}:${String(f.weight)}:${f.italic ? 1 : 0}:${f.bytes.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: key, data: f.bytes });
    }
    this.send(out);
  }

  private send(fonts: PreviewFont[]): void {
    const sig = fonts.map((f) => f.name).join("\n");
    if (sig === this.last) return;
    this.last = sig;
    this.apply(fonts);
  }

  /** The player was replaced: hand the current set to the new one. */
  reset(): void {
    this.last = "\u0000";
    this.schedule(0);
  }

  private file(family: string, weight: number, italic: boolean): Promise<FontFile | null> {
    const key = `${family.toLowerCase()}|${weight}|${italic ? 1 : 0}`;
    let p = this.files.get(key);
    if (!p) {
      p = getFontFile(family, { weight, italic, instance: true, local: this.sources.local, remote: this.sources.remote }).catch(() => null);
      this.files.set(key, p);
    }
    return p;
  }

  destroy(): void {
    window.clearTimeout(this.timer);
    this.run++;
    this.off();
  }
}
