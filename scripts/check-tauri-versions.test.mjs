import { describe, expect, it } from "vitest";
import { checkTauriVersions } from "./check-tauri-versions.mjs";

const packageLock = (versions) =>
  JSON.stringify({
    packages: Object.fromEntries(Object.entries(versions).map(([name, version]) => [`node_modules/${name}`, { version }])),
  });

const cargoLock = (versions) =>
  Object.entries(versions)
    .map(([name, version]) => `[[package]]\nname = "${name}"\nversion = "${version}"\n`)
    .join("\n");

const matchingNpm = {
  "@tauri-apps/api": "2.12.3",
  "@tauri-apps/cli": "2.12.2",
  "@tauri-apps/plugin-opener": "2.7.1",
};
const matchingRust = { tauri: "2.12.3", "tauri-plugin-opener": "2.7.1" };

describe("checkTauriVersions", () => {
  it("accepts matching major.minor versions", () => {
    expect(checkTauriVersions(packageLock(matchingNpm), cargoLock(matchingRust))).toEqual([]);
  });

  it("reports a major.minor mismatch", () => {
    const errors = checkTauriVersions(packageLock({ ...matchingNpm, "@tauri-apps/cli": "3.0.0" }), cargoLock(matchingRust));
    expect(errors).toContain("@tauri-apps/cli 3.0.0 and tauri 2.12.3 do not share a major.minor version");
  });

  it("reports missing packages from either lockfile", () => {
    const npm = { ...matchingNpm };
    delete npm["@tauri-apps/api"];
    const rust = { ...matchingRust };
    delete rust["tauri-plugin-opener"];
    const errors = checkTauriVersions(packageLock(npm), cargoLock(rust));
    expect(errors).toContain("Missing @tauri-apps/api in package-lock.json");
    expect(errors).toContain("Missing tauri-plugin-opener in src-tauri/Cargo.lock");
  });
});
