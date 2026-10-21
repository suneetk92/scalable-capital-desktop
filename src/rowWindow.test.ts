import { describe, expect, it } from "vitest";
import { windowOf } from "./rowWindow";

describe("windowOf", () => {
  it("renders a small list in full without spacers", () => {
    expect(windowOf({ count: 4, scrollTop: 0, viewport: 100, heightOf: () => 20 })).toEqual({ start: 0, end: 4, top: 0, bottom: 0 });
  });

  it("keeps the visible range and overscan within the list", () => {
    const result = windowOf({ count: 100, scrollTop: 500, viewport: 100, heightOf: () => 10, overscan: 2, minItems: 0 });
    expect(result).toEqual({ start: 48, end: 63, top: 480, bottom: 370 });
  });

  it("uses measured variable heights for spacers", () => {
    const heights = [10, 20, 30, 40, 50, 60];
    const result = windowOf({ count: heights.length, scrollTop: 65, viewport: 45, heightOf: (index) => heights[index]!, overscan: 0, minItems: 0 });
    expect(result).toEqual({ start: 3, end: 5, top: 60, bottom: 60 });
  });

  it("clamps the window at the end and falls back for invalid heights", () => {
    const result = windowOf({ count: 100, scrollTop: 10_000, viewport: 100, heightOf: (index) => (index === 0 ? Number.NaN : 10), overscan: 2, minItems: 0 });
    expect(result).toEqual({ start: 98, end: 100, top: 56 + 97 * 10, bottom: 0 });
  });
});
