import { defineConfig } from "cypress";

// End-to-end tests run against the built demo (npm run test:e2e serves demo-dist on 5174).
// They exist to cover the one thing the node suite cannot reach: editor.ts, which is by far
// the largest file in the project and which no unit test touches, because everything it does
// it does to the DOM.
export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:5174",
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: false,
    video: false,
    screenshotOnRunFailure: false,
    defaultCommandTimeout: 10000,
  },
});
