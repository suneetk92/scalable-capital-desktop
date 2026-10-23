import { defineConfig } from "@playwright/test";

/** UI tests: the app runs in a headless browser with a mocked Tauri runtime and made-up data (see `e2e/`). */
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://localhost:5199", viewport: { width: 1600, height: 900 } },
  webServer: { command: "npm run dev -- --port 5199 --strictPort", url: "http://localhost:5199", reuseExistingServer: true, timeout: 60_000 },
  reporter: "list",
  outputDir: "e2e/output",
});
