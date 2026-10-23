import { describe, expect, it } from "vite-plus/test";
import { selectionState, selectOptions } from "./selection";

describe("bulk selection", () => {
  it("distinguishes empty, partial and complete selections within the options", () => {
    expect(selectionState([], [])).toEqual({ checked: false, indeterminate: false });
    expect(selectionState(["a", "b"], ["other"])).toEqual({ checked: false, indeterminate: false });
    expect(selectionState(["a", "b"], ["a", "other"])).toEqual({ checked: false, indeterminate: true });
    expect(selectionState(["a", "b"], ["b", "a", "other"])).toEqual({ checked: true, indeterminate: false });
  });

  it("selects every match without duplicates and preserves selections outside the scope", () => {
    expect(selectOptions(["a", "b"], ["other", "a"], true)).toEqual(["other", "a", "b"]);
    expect(selectOptions(["a", "b"], ["other", "a", "b"], false)).toEqual(["other"]);
    expect(selectOptions([], ["other"], true)).toEqual(["other"]);
    expect(selectOptions([], ["other"], false)).toEqual(["other"]);
  });

  it("selects all matching options even when only the first 200 are rendered", () => {
    const options = Array.from({ length: 250 }, (_, i) => String(i));
    const selected = selectOptions(options, [], true);
    expect(selected).toEqual(options);
    expect(selectionState(options, selected).checked).toBe(true);
  });
});
