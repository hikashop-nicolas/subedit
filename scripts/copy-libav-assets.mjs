// Copies the vendored libav.js AC-3/E-AC-3/DTS/TrueHD decoder out of the installed
// mediaplay package into demo/public/libav/ so the embedded preview can load the decoder
// from a same-origin URL and play Dolby/DTS audio tracks. Generated (gitignored).
import { cpSync, mkdirSync, rmSync, readdirSync } from "node:fs";

const SRC = "node_modules/mediaplay/libav";
const OUT = "demo/public/libav";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(SRC)) cpSync(`${SRC}/${f}`, `${OUT}/${f}`);
console.log("libav assets copied to demo/public/libav/");
