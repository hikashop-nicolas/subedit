import { defineConfig } from "vite";

// The demo lives in demo/; build it to demo-dist/ for GitHub Pages. base "./" so it
// works from any repo-subpath. Vitest runs the pure round-trip tests under node.
export default defineConfig({
  root: "demo",
  base: "./",
  build: { outDir: "../demo-dist", emptyOutDir: true },
  test: {
    root: ".",
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
