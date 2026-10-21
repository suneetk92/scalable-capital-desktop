import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TAURI_PACKAGES = [
  { npm: "@tauri-apps/api", rust: "tauri" },
  { npm: "@tauri-apps/cli", rust: "tauri" },
  { npm: "@tauri-apps/plugin-opener", rust: "tauri-plugin-opener" },
];

function cargoVersions(text, packageName) {
  return text.split(/^\[\[package\]\]\s*$/m).flatMap((block) => {
    const name = block.match(/^name = "([^"]+)"/m)?.[1];
    const version = block.match(/^version = "([^"]+)"/m)?.[1];
    return name === packageName && version ? [version] : [];
  });
}

function majorMinor(version) {
  return (
    version
      .match(/^(\d+)\.(\d+)(?:\.|$)/)
      ?.slice(1)
      .join(".") ?? null
  );
}

export function checkTauriVersions(packageLockText, cargoLockText) {
  const packageLock = JSON.parse(packageLockText);
  const errors = [];
  for (const { npm, rust } of TAURI_PACKAGES) {
    const npmVersion = packageLock.packages?.[`node_modules/${npm}`]?.version;
    const rustVersions = cargoVersions(cargoLockText, rust);
    if (!npmVersion) {
      errors.push(`Missing ${npm} in package-lock.json`);
      continue;
    }
    if (rustVersions.length === 0) {
      errors.push(`Missing ${rust} in src-tauri/Cargo.lock`);
      continue;
    }
    const npmMinor = majorMinor(npmVersion);
    const rustMinors = [...new Set(rustVersions.map(majorMinor))];
    if (!npmMinor || rustMinors.includes(null)) {
      errors.push(`Could not parse a major.minor version for ${npm} (${npmVersion}) or ${rust}`);
    } else if (rustMinors.length !== 1 || rustMinors[0] !== npmMinor) {
      errors.push(`${npm} ${npmVersion} and ${rust} ${rustVersions.join(", ")} do not share a major.minor version`);
    }
  }
  return errors;
}

function main() {
  const packageLock = readFileSync(new URL("../package-lock.json", import.meta.url), "utf8");
  const cargoLock = readFileSync(new URL("../src-tauri/Cargo.lock", import.meta.url), "utf8");
  const errors = checkTauriVersions(packageLock, cargoLock);
  if (errors.length > 0) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("Tauri npm packages and Rust crates share their major.minor versions.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
