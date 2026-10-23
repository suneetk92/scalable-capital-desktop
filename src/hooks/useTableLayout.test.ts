import { describe, expect, it } from "vite-plus/test";
import { mergeOrder, moveColumn } from "./useTableLayout";

describe("mergeOrder", () => {
  it("keeps the stored order, drops unknown columns and places new ones after their default predecessor", () => {
    expect(mergeOrder(["c", "x", "a"], ["a", "b", "c", "d"])).toEqual(["c", "d", "a", "b"]);
  });

  it("starts with the defaults when nothing is stored, and puts a new first column first", () => {
    expect(mergeOrder([], ["a", "b"])).toEqual(["a", "b"]);
    expect(mergeOrder(["b"], ["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("moveColumn", () => {
  it("moves a column before or after another", () => {
    expect(moveColumn(["a", "b", "c"], "a", "c", false)).toEqual(["b", "a", "c"]);
    expect(moveColumn(["a", "b", "c"], "a", "c", true)).toEqual(["b", "c", "a"]);
    expect(moveColumn(["a", "b", "c"], "c", "a", false)).toEqual(["c", "a", "b"]);
  });

  it("leaves the order alone for unknown columns", () => {
    expect(moveColumn(["a", "b"], "a", "z", true)).toEqual(["a", "b"]);
  });
});
