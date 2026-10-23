// Sets the version of one extension, which is versioned apart from the app:
//
//   node scripts/set-extension-version.mjs trailing-stops 1.2.0
//
// Edits extensions/<id>/extension.json; Settings > About lists it. Run it from the repository root.
import { readFileSync, writeFileSync } from "node:fs";

const [id, raw] = process.argv.slice(2);
const version = (raw ?? "").replace(/^v/, "");
if (!/^[a-z0-9-]+$/.test(id ?? "") || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("usage: node scripts/set-extension-version.mjs <extension-id> <X.Y.Z[-pre]>");
  process.exit(1);
}

const path = `extensions/${id}/extension.json`;
const text = readFileSync(path, "utf8");
const manifest = JSON.parse(text);
manifest.version = version;
writeFileSync(path, JSON.stringify(manifest, null, 2) + (text.endsWith("\n") ? "\n" : ""));
console.log(`${manifest.name} ${version}`);
