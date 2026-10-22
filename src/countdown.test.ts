import { describe, expect, it } from "vitest";
import { elapsedShare } from "./countdown";

describe("elapsedShare", () => {
  it("grows from 0 to 1 over the interval and stays within that range", () => {
    expect(elapsedShare(1000, 1000, 30_000)).toBe(0);
    expect(elapsedShare(1000, 16_000, 30_000)).toBe(0.5);
    expect(elapsedShare(1000, 99_000, 30_000)).toBe(1);
    expect(elapsedShare(5000, 1000, 30_000)).toBe(0);
    expect(elapsedShare(0, 10, 0)).toBe(0);
  });
});
