import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import type { Plugin, PluginOption } from "vite";
import { defineConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;

type ExtensionConfig = { plugins?: PluginOption[]; test?: { include?: string[]; setupFiles?: string[] } };
type ExtensionBuild = { entries: string[]; plugins: PluginOption[]; include: string[]; setupFiles: string[] };

/**
 * The extensions of the build: the ones listed in `bundled-extensions.json`, which ship with the app, and with
 * `--mode extension` also the optional one in the folder named by `APP_EXTENSION_DIR`. Each has its `web/index.ts` and may
 * add Vite plugins and tests in its own `vite.mjs`.
 */
async function extensionBuild(mode: string): Promise<ExtensionBuild> {
  const bundled = JSON.parse(readFileSync(resolve(process.cwd(), "bundled-extensions.json"), "utf8")) as string[];
  const optional = mode === "extension" ? [process.env.APP_EXTENSION_DIR] : [];
  if (mode === "extension" && !optional[0]) throw new Error('Mode "extension" needs APP_EXTENSION_DIR, the folder of the extension.');
  const build: ExtensionBuild = { entries: [], plugins: [], include: [], setupFiles: [] };
  for (const folder of [...bundled, ...optional] as string[]) {
    const dir = resolve(process.cwd(), folder);
    const entry = resolve(dir, "web/index.ts");
    if (!existsSync(entry)) throw new Error(`No extension at ${entry}.`);
    build.entries.push(entry);
    const file = resolve(dir, "vite.mjs");
    const config = existsSync(file) ? ((await import(pathToFileURL(file).href)) as { default: ExtensionConfig }).default : {};
    build.plugins.push(...(config.plugins ?? []));
    build.include.push(...(config.test?.include ?? (bundled.includes(folder) ? [`${folder}/web/**/*.test.{ts,tsx}`] : [])));
    build.setupFiles.push(...(config.test?.setupFiles ?? []));
  }
  return build;
}

/** `virtual:app-extensions` lists the `web/index.ts` default export of every extension of the build. */
function appExtensions(entries: string[]): Plugin {
  const id = "virtual:app-extensions";
  return {
    name: "app-extensions",
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load: (source) =>
      source === `\0${id}`
        ? [...entries.map((entry, index) => `import extension${index} from ${JSON.stringify(entry.replaceAll("\\", "/"))};`), `export default [${entries.map((_, index) => `extension${index}`).join(", ")}];`].join("\n")
        : undefined,
  };
}

export default defineConfig(async ({ mode }) => {
  const extensions = await extensionBuild(mode);
  return {
    plugins: [react(), tailwindcss(), appExtensions(extensions.entries), ...extensions.plugins],
    clearScreen: false,
    build: {
      // The bundle loads from local disk, so the 500 kB web default does not apply.
      chunkSizeWarningLimit: 3000,
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs", ...extensions.include],
      setupFiles: extensions.setupFiles,
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
