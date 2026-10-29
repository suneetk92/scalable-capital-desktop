// Writes the update site for the Tauri updater from the signed release files: latest.json (the
// updater's manifest) and index.html (a download page for installs that cannot update themselves).
//
//   node scripts/make-latest-json.mjs <artifacts-dir> <tag> <base-url> <out-dir> [--partial]
//     [--download-base=<url>] [--notes-url=<url>] [--notes-file=<path>]
//
// There is one update channel, stable: the app is never offered a pre-release, and
// scripts/publish-github-release.sh publishes no manifest for a pre-release tag (v1.2.3-rc.1). The
// Windows MSI cannot carry a pre-release version, so pre-release builds are NSIS only and the MSI is
// not required for them.
//
// <base-url> is the public https folder that holds latest.json, for example
// https://updates.example.com/scalable-capital-desktop. The installers are expected at <base-url>/<tag>/<file>.
// Every platform needs an installer file and its `.sig` file next to it in the artifacts directory; a
// missing one stops the release instead of shipping an update that some installs cannot find.
// `--partial` lists only the platforms that have a file, and still needs at least one: for trying the
// manifest on the files of one machine (a release always needs every platform).
// `--download-base` puts the installers at <download-base>/<tag>/<file> instead of under <base-url>
// (GitHub Releases: https://github.com/<owner>/<repo>/releases/download), and `--notes-url` replaces the
// link to the download page in the manifest's notes. `--notes-file` puts the text of a release notes file
// (from scripts/release-notes.mjs) in front of that link, so the app's update notice shows what changed.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * updater platform key -> pattern of the file name that platform installs from. The plain
 * `windows-x86_64` key is for the portable exe: it was not made by an installer, so the updater knows
 * no bundle type for it and looks only for that key. It installs with the NSIS installer.
 */
export const PLATFORMS = {
  "windows-x86_64-nsis": /_x64-setup\.exe$/,
  "windows-x86_64": /_x64-setup\.exe$/,
  "windows-x86_64-msi": /_x64_[A-Za-z-]+\.msi$/,
  "darwin-aarch64": /_aarch64\.app\.tar\.gz$/,
  "darwin-x86_64": /_x64\.app\.tar\.gz$/,
  "linux-x86_64": /_amd64\.AppImage$/,
  "linux-aarch64": /_(aarch64|arm64)\.AppImage$/,
};

/** A tag like v1.2.3-rc.1 is a pre-release; v1.2.3 is stable. */
const isPrerelease = (tag) => tag.includes("-");

/** Installers people download by hand; the signatures and checksums are not listed. */
const DOWNLOADS = /\.(exe|msi|dmg|deb|rpm|AppImage)$/;

const escapeHtml = (text) => text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);

function cleanBase(baseUrl) {
  const base = baseUrl.replace(/\/+$/, "");
  if (!/^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(base)) throw new Error(`The base URL "${baseUrl}" is not an https folder URL.`);
  return base;
}

/**
 * @param {string[]} names file names in the artifacts directory
 * @param {(name: string) => string} readSignature content of a `.sig` file
 * @param {{ tag: string, baseUrl: string, downloadBase?: string, notesUrl?: string, notesText?: string, now?: Date, partial?: boolean }} options
 */
export function buildLatest(names, readSignature, { tag, baseUrl, downloadBase, notesUrl, notesText, now = new Date(), partial = false }) {
  if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag)) throw new Error(`The tag "${tag}" is not a version like v1.2.3.`);
  const base = cleanBase(baseUrl);
  const installersBase = cleanBase(downloadBase ?? baseUrl);
  const platforms = {};
  for (const [key, pattern] of Object.entries(PLATFORMS)) {
    if (key.endsWith("-msi") && isPrerelease(tag)) continue;
    const files = names.filter((name) => pattern.test(name));
    if (partial && files.length === 0) continue;
    if (files.length !== 1) throw new Error(`${key}: expected one file matching ${pattern}, found ${files.length}.`);
    const [file] = files;
    if (!names.includes(`${file}.sig`)) throw new Error(`${key}: ${file}.sig is missing.`);
    const signature = readSignature(`${file}.sig`).trim();
    if (!signature) throw new Error(`${file}.sig is empty.`);
    platforms[key] = { signature, url: `${installersBase}/${tag}/${encodeURIComponent(file)}` };
  }
  if (Object.keys(platforms).length === 0) throw new Error("No updatable installer was found.");
  const downloads = `See ${notesUrl ?? `${base}/index.html`} for the downloads.`;
  return {
    version: tag.slice(1),
    notes: notesText?.trim() ? `${notesText.trim()}\n\n${downloads}` : downloads,
    pub_date: now.toISOString(),
    platforms,
  };
}

/** A plain download page for the current version, with no scripts or remote assets. */
export function buildIndexHtml(names, { tag, baseUrl }) {
  const base = cleanBase(baseUrl);
  const items = names
    .filter((name) => DOWNLOADS.test(name))
    .sort()
    .map((name) => `      <li><a href="${escapeHtml(`${base}/${tag}/${encodeURIComponent(name)}`)}">${escapeHtml(name)}</a></li>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Scalable Capital Desktop ${escapeHtml(tag)}</title>
  </head>
  <body>
    <h1>Scalable Capital Desktop ${escapeHtml(tag)}</h1>
    <p>Installed apps update themselves. Download an installer here for a first install, or to update a portable, deb or rpm install by hand. Verify a download with <a href="${escapeHtml(`${base}/${tag}/SHA256SUMS.txt`)}">SHA256SUMS.txt</a>.</p>
    <ul>
${items}
    </ul>
  </body>
</html>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const partial = args.includes("--partial");
  const flag = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const [dir, tag, baseUrl, outDir] = args.filter((arg) => !arg.startsWith("--"));
  if (!dir || !tag || !baseUrl || !outDir) {
    console.error("Usage: node scripts/make-latest-json.mjs <artifacts-dir> <tag> <base-url> <out-dir> [--partial] [--download-base=<url>] [--notes-url=<url>] [--notes-file=<path>]");
    process.exit(2);
  }
  const names = readdirSync(dir);
  const latest = buildLatest(names, (name) => readFileSync(join(dir, name), "utf8"), {
    tag,
    baseUrl,
    partial,
    downloadBase: flag("download-base"),
    notesUrl: flag("notes-url"),
    notesText: flag("notes-file") ? readFileSync(flag("notes-file"), "utf8") : undefined,
  });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);
  writeFileSync(join(outDir, "index.html"), buildIndexHtml(names, { tag, baseUrl }));
  console.log(`Wrote latest.json, index.html in ${outDir} for ${tag}: ${Object.keys(latest.platforms).join(", ")}`);
}
