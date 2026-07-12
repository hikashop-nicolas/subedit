// Copies the SubtitlesOctopus (libass WASM) worker + fallback font from
// @jellyfin/libass-wasm (a transitive dep via mediaplay) into demo/public/octopus/ so
// the embedded mediaplay preview can spawn its worker from a same-origin URL and render
// styled ASS. Generated (gitignored); run via the dev/build:demo scripts.
import { cpSync, mkdirSync, rmSync } from "node:fs";

const SRC = "node_modules/@jellyfin/libass-wasm/dist/js";
const OUT = "demo/public/octopus";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of ["subtitles-octopus-worker.js", "subtitles-octopus-worker.wasm", "default.woff2", "COPYRIGHT"]) {
  cpSync(`${SRC}/${f}`, `${OUT}/${f}`);
}
console.log("octopus assets copied to demo/public/octopus/");
