import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import type { Plugin, PluginOption } from "vite";
import { defineConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;

type ExtensionConfig = { plugins?: PluginOption[]; test?: { include?: string[]; setupFiles?: string[] } };

/**
 * `--mode extension` builds in an optional extension from the folder named by `APP_EXTENSION_DIR` (its
 * `web/index.ts` and its own Vite plugins and tests in `vite.mjs`); every other mode uses the empty stub.
 */
async function extensionConfig(mode: string): Promise<{ entry: string; config: ExtensionConfig }> {
  if (mode !== "extension") return { entry: resolve(process.cwd(), "src/extensionStub.ts"), config: {} };
  if (!process.env.APP_EXTENSION_DIR) throw new Error('Mode "extension" needs APP_EXTENSION_DIR, the folder of the extension.');
  const dir = resolve(process.cwd(), process.env.APP_EXTENSION_DIR);
  const entry = resolve(dir, "web/index.ts");
  if (!existsSync(entry)) throw new Error(`No extension at ${entry}.`);
  const file = resolve(dir, "vite.mjs");
  const config = existsSync(file) ? ((await import(pathToFileURL(file).href)) as { default: ExtensionConfig }).default : {};
  return { entry, config };
}

/** `virtual:app-extension` is the empty extension unless `--mode extension` selects one. */
function appExtension(entry: string): Plugin {
  return {
    name: "app-extension",
    resolveId: (id) => (id === "virtual:app-extension" ? entry : undefined),
  };
}

export default defineConfig(async ({ mode }) => {
  const extension = await extensionConfig(mode);
  return {
    plugins: [react(), tailwindcss(), appExtension(extension.entry), ...(extension.config.plugins ?? [])],
    clearScreen: false,
    build: {
      // The bundle loads from local disk, so the 500 kB web default does not apply.
      chunkSizeWarningLimit: 3000,
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs", ...(extension.config.test?.include ?? [])],
      setupFiles: extension.config.test?.setupFiles ?? [],
    },
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
  };
});
