import { describe, expect, it } from "vitest";
import { buildNotes } from "./release-notes.mjs";

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
});
