import { describe, expect, it } from "vitest";
import { matchesText } from "./textSearch";

describe("matchesText", () => {
  it("matches everything for an empty query", () => {
    expect(matchesText("  ", ["Rheinmetall"])).toBe(true);
  });
  it("needs every word, in any order and any field, ignoring case", () => {
    expect(matchesText("meta stop", ["Meta", null, "Trailing stop"])).toBe(true);
    expect(matchesText("stop rhein", ["Meta", "Trailing stop"])).toBe(false);
  });
});
