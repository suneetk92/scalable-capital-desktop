import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["package.json", "package-lock.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/tauri.conf.json"];

/** Runs a script of this folder in `cwd`; returns its exit code and output. */
function run(script, args, cwd) {
  try {
    return { code: 0, output: execFileSync("node", [join(root, "scripts", script), ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (error) {
    return { code: error.status, output: `${error.stdout}${error.stderr}` };
  }
}

let dir = "";
const read = (path) => readFileSync(join(dir, path), "utf8");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "set-version-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("set-version.mjs", () => {
  beforeEach(() => {
    for (const file of FILES) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      cpSync(join(root, file), join(dir, file));
    }
  });

  it("writes the version of a tag into every file and keeps the rest", () => {
    const before = Object.fromEntries(FILES.map((file) => [file, read(file)]));
    expect(run("set-version.mjs", ["v9.8.7-rc.1"], dir).code).toBe(0);
    expect(JSON.parse(read("package.json")).version).toBe("9.8.7-rc.1");
    expect(JSON.parse(read("src-tauri/tauri.conf.json")).version).toBe("9.8.7-rc.1");
    const lock = JSON.parse(read("package-lock.json"));
    expect([lock.version, lock.packages[""].version]).toEqual(["9.8.7-rc.1", "9.8.7-rc.1"]);
    expect(read("src-tauri/Cargo.toml")).toMatch(/^\[package\]\nname = "scalable-capital-desktop"\nversion = "9\.8\.7-rc\.1"$/m);
    expect(read("src-tauri/Cargo.lock")).toMatch(/name = "scalable-capital-desktop"\r?\nversion = "9\.8\.7-rc\.1"/);
    // Only the version lines change.
    for (const file of FILES) {
      const changed = read(file)
        .split("\n")
        .filter((line, index) => line !== before[file].split("\n")[index]);
      expect(
        changed.every((line) => line.includes("9.8.7-rc.1")),
        file,
      ).toBe(true);
    }
  });

  it("accepts a version without the v and changes nothing a second time", () => {
    expect(run("set-version.mjs", ["1.2.3"], dir).code).toBe(0);
    const once = FILES.map(read);
    expect(run("set-version.mjs", ["v1.2.3"], dir).code).toBe(0);
    expect(FILES.map(read)).toEqual(once);
  });

  it("refuses something that is not a version", () => {
    for (const bad of ["", "1.2", "v1.2.3-", "1.2.3+build", "latest"]) expect(run("set-version.mjs", [bad], dir).code, bad).toBe(1);
    expect(read("package.json")).toBe(readFileSync(join(root, "package.json"), "utf8"));
  });
});

describe("set-extension-version.mjs", () => {
  beforeEach(() => {
    mkdirSync(join(dir, "extensions/trailing-stops"), { recursive: true });
    writeFileSync(join(dir, "extensions/trailing-stops/extension.json"), `${JSON.stringify({ id: "trailing-stops", name: "Trailing stops", version: "1.0.0", description: "A test." }, null, 2)}\n`);
  });

  it("sets the version and keeps the other fields and the final newline", () => {
    const result = run("set-extension-version.mjs", ["trailing-stops", "v1.2.0"], dir);
    expect(result).toEqual({ code: 0, output: "Trailing stops 1.2.0\n" });
    expect(read("extensions/trailing-stops/extension.json")).toBe(`${JSON.stringify({ id: "trailing-stops", name: "Trailing stops", version: "1.2.0", description: "A test." }, null, 2)}\n`);
  });

  it("refuses a bad id or version", () => {
    for (const args of [["../trailing-stops", "1.2.0"], ["Trailing-Stops", "1.2.0"], ["trailing-stops", "1.2"], ["trailing-stops"]])
      expect(run("set-extension-version.mjs", args, dir).code, args.join(" ")).toBe(1);
    expect(JSON.parse(read("extensions/trailing-stops/extension.json")).version).toBe("1.0.0");
  });
});
