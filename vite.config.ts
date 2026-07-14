import { defineConfig } from "vite";

// The demo lives in demo/; build it to demo-dist/ for GitHub Pages. base "./" so it
// works from any repo-subpath. Vitest runs the pure round-trip tests under node.
export default defineConfig({
  root: "demo",
  base: "./",
  // mediabunny is our own fork under active change; don't let Vite pre-bundle it into a cached
  // optimized dep, which goes stale when the fork pin changes (serving old code to the app).
  // Serving it raw keeps the dev server in sync with the installed module.
  optimizeDeps: { exclude: ["mediabunny", "mediaplay"] },
  build: { outDir: "../demo-dist", emptyOutDir: true },
  test: {
    root: ".",
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
