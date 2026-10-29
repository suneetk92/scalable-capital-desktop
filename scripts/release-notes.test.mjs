import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { buildNotes, commitsFor } from "./release-notes.mjs";

describe("buildNotes", () => {
  it("groups commits by their prefix and leaves out maintenance commits", () => {
    const notes = buildNotes(["feat(markets): add a world map.", "fix: the watchlist no longer breaks", "chore: bump deps", "refactor: split App", "Tidy the sign-in screen"]);
    expect(notes).toBe("### New\n\n- Add a world map\n\n### Fixed\n\n- The watchlist no longer breaks\n\n### Changed\n\n- Tidy the sign-in screen");
  });

  it("skips merges and release commits and lists a repeated subject once", () => {
    const notes = buildNotes(["Merge branch 'x'", "Release v1.2.3", "v1.2.2", "Fix a thing", "fix a thing"]);
    expect(notes).toBe("### Changed\n\n- Fix a thing");
  });

  it("marks a breaking change", () => {
    expect(buildNotes(["feat!: drop the old format"])).toBe("### New\n\n- **Breaking:** Drop the old format");
  });

  it("shortens a long list", () => {
    const notes = buildNotes(Array.from({ length: 30 }, (_, index) => `feat: thing ${index}`));
    expect(notes.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(26);
    expect(notes).toContain("- And 5 more.");
  });

  it("has a plain line when nothing user-facing changed", () => {
    expect(buildNotes(["chore: x", "ci: y"])).toContain("no changes you will notice");
    expect(buildNotes([])).toContain("no changes you will notice");
  });

  it("lists a breaking change under any type, from the subject or a BREAKING CHANGE footer", () => {
    expect(buildNotes(["refactor!: drop the old settings format", "chore: x"])).toBe("### Changed\n\n- **Breaking:** Drop the old settings format");
    expect(buildNotes([{ subject: "build: move to a new runtime", body: "BREAKING CHANGE: Windows 10 is no longer supported." }])).toBe("### Changed\n\n- **Breaking:** Move to a new runtime");
    expect(buildNotes([{ subject: "fix: tidy the export", body: "BREAKING-CHANGE: the CSV has new columns" }])).toBe("### Fixed\n\n- **Breaking:** Tidy the export");
    expect(buildNotes([{ subject: "chore: bump deps", body: "Mentions a BREAKING CHANGE: only in the middle of a line." }])).toContain("no changes you will notice");
  });

  it("lists a revert of an earlier release's change, but not one made within the same release", () => {
    expect(buildNotes(['Revert "feat: add a world map"'])).toBe("### Changed\n\n- Reverted: Add a world map");
    expect(buildNotes(['Revert "feat: add a world map"', "feat: add a world map", "fix: keep the order"])).toBe("### Fixed\n\n- Keep the order");
    expect(buildNotes(['Revert "chore: bump deps"'])).toContain("no changes you will notice");
  });
});

describe("commitsFor", () => {
  let repo = "";
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const commit = (subject, body = "") => git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-q", "-m", subject, ...(body ? ["-m", body] : []));
  const subjects = (tag) => commitsFor(tag, repo).map((entry) => entry.subject);

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "release-notes-"));
    git("init", "-q");
    commit("feat: first");
    git("tag", "v1.0.0");
    commit("feat: second", "BREAKING CHANGE: something");
    git("tag", "v1.1.0-rc.1");
    commit("fix: third");
    git("tag", "v1.1.0");
    commit("feat: fourth");
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("reads the whole history before the first release", () => {
    expect(subjects("v1.0.0")).toEqual(["feat: first"]);
  });

  it("starts a stable tag at the previous stable tag, so release candidate changes are included", () => {
    expect(subjects("v1.1.0")).toEqual(["fix: third", "feat: second"]);
  });

  it("starts a pre-release tag at the previous tag of any kind", () => {
    expect(subjects("v1.1.0-rc.1")).toEqual(["feat: second"]);
  });

  it("reads HEAD for a tag that is not made yet, and keeps the message body", () => {
    expect(subjects("v1.2.0")).toEqual(["feat: fourth"]);
    expect(commitsFor("v1.1.0-rc.1", repo)[0]).toEqual({ subject: "feat: second", body: "BREAKING CHANGE: something" });
  });
});
