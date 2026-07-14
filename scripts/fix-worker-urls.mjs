// tsc transpiles each file 1:1 and leaves `new URL("./x.worker.ts", import.meta.url)`
// pointing at the .ts source. In the published dist only the compiled .worker.js exists,
// so a consuming bundler (Vite) can't resolve the .ts entry. Rewrite the worker URLs to
// .js in the built dist. Source keeps .ts so subedit's own Vite dev/build still works.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = new URL("../dist/transcribe/", import.meta.url).pathname;
const rx = /(new URL\(\s*["']\.\/[\w.-]+\.worker)\.ts(["'])/g;

for (const name of readdirSync(dir)) {
  if (!name.endsWith(".js")) continue;
  const file = join(dir, name);
  const src = readFileSync(file, "utf8");
  const out = src.replace(rx, "$1.js$2");
  if (out !== src) {
    writeFileSync(file, out);
    console.log(`fixed worker URLs in dist/transcribe/${name}`);
  }
}
