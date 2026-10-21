// Writes one version into every place the app keeps it, so a release tag can drive the build:
//
//   node scripts/set-version.mjs v1.2.3     (or 1.2.3)
//
// Updates package.json, package-lock.json, src-tauri/Cargo.toml, the scalable-capital-desktop entry in
// src-tauri/Cargo.lock and src-tauri/tauri.conf.json. Run it from the repository root.
import { readFileSync, writeFileSync } from "node:fs";

const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("usage: node scripts/set-version.mjs <vX.Y.Z[-pre]>");
  process.exit(1);
}

function edit(path, change) {
  const before = readFileSync(path, "utf8");
  const after = change(before);
  if (after === before && !before.includes(version)) throw new Error(`no version found in ${path}`);
  if (after !== before) writeFileSync(path, after);
}

// The first "version" key in each JSON file is the app's own; the replacements keep the file layout.
const jsonVersion = (text) => text.replace(/("version": ")[^"]*(")/, `$1${version}$2`);
edit("package.json", jsonVersion);
edit("src-tauri/tauri.conf.json", jsonVersion);
edit("package-lock.json", (text) => {
  const lock = JSON.parse(text);
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
  return JSON.stringify(lock, null, 2) + (text.endsWith("\n") ? "\n" : "");
});
edit("src-tauri/Cargo.toml", (text) => text.replace(/^version = "[^"]*"/m, `version = "${version}"`));
edit("src-tauri/Cargo.lock", (text) => text.replace(/(name = "scalable-capital-desktop"\r?\nversion = ")[^"]*(")/, `$1${version}$2`));

console.log(`version set to ${version}`);
