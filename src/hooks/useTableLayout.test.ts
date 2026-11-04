// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { readStoredJson, writeStoredJson } from "../storage";
import { mergeOrder, moveColumn, renameStoredColumns, useColumnWidths, useTableLayout } from "./useTableLayout";

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

describe("renameStoredColumns", () => {
  beforeEach(() => window.localStorage.clear());

  it("renames legacy ids in stored order and widths once", () => {
    writeStoredJson("table.trailing-stops", {
      order: ["actions", "placed", "atAbout", "name"],
      widths: { placed: 12, atAbout: 14, actions: 9 },
    });

    renameStoredColumns("trailing-stops", { placed: "executedAt", atAbout: "executionPrice" });
    const migrated = readStoredJson("table.trailing-stops");
    expect(migrated).toEqual({
      order: ["actions", "executedAt", "executionPrice", "name"],
      widths: { executedAt: 12, executionPrice: 14, actions: 9 },
    });

    renameStoredColumns("trailing-stops", { placed: "executedAt", atAbout: "executionPrice" });
    expect(readStoredJson("table.trailing-stops")).toEqual(migrated);
  });

  it("leaves missing layouts and layouts with conflicting old and new ids alone", () => {
    renameStoredColumns("missing", { placed: "executedAt" });
    expect(readStoredJson("table.missing")).toBeNull();

    const conflict = { order: ["placed", "executedAt"], widths: { placed: 12, executionPrice: 14 } };
    writeStoredJson("table.trailing-stops", conflict);
    renameStoredColumns("trailing-stops", { placed: "executedAt", atAbout: "executionPrice" });
    expect(readStoredJson("table.trailing-stops")).toEqual(conflict);
  });
});

describe("useColumnWidths and useTableLayout", () => {
  beforeEach(() => window.localStorage.clear());

  it("reads the widths of the new table when the name changes and never saves them under the other name", () => {
    writeStoredJson("table.screener-portfolio", { order: [], widths: { symbol: 10 } });
    writeStoredJson("table.screener-watchlist", { order: [], widths: { symbol: 20 } });
    const { result, rerender } = renderHook(({ name }) => useColumnWidths(name), { initialProps: { name: "screener-portfolio" } });
    expect(result.current[0]).toEqual({ symbol: 10 });
    rerender({ name: "screener-watchlist" });
    expect(result.current[0]).toEqual({ symbol: 20 });
    expect(readStoredJson("table.screener-watchlist")).toMatchObject({ widths: { symbol: 20 } });
    act(() => result.current[1]({ symbol: 25 }));
    expect(readStoredJson("table.screener-watchlist")).toMatchObject({ widths: { symbol: 25 } });
    expect(readStoredJson("table.screener-portfolio")).toMatchObject({ widths: { symbol: 10 } });
  });

  it("keeps the order of each table under its own name", () => {
    writeStoredJson("table.one", { order: ["b", "a"], widths: null });
    const { result, rerender } = renderHook(({ name }) => useTableLayout(name, ["a", "b"]), { initialProps: { name: "one" } });
    expect(result.current.order).toEqual(["b", "a"]);
    rerender({ name: "two" });
    expect(result.current.order).toEqual(["a", "b"]);
    expect(readStoredJson("table.one")).toMatchObject({ order: ["b", "a"] });
  });
});
