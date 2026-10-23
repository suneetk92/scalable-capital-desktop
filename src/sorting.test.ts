import { describe, expect, it } from "vite-plus/test";
import { nextSort, sortItems } from "./sorting";

type Row = { name?: string | null; value?: number | null };
const valueOf = (row: Row, key: string) => row[key as keyof Row];

describe("nextSort", () => {
  it("goes ascending, descending, then back to the original order", () => {
    const first = nextSort(null, "value");
    expect(first).toEqual({ key: "value", direction: "ascending" });
    const second = nextSort(first, "value");
    expect(second).toEqual({ key: "value", direction: "descending" });
    expect(nextSort(second, "value")).toBeNull();
  });

  it("starts ascending when another column is clicked", () => {
    expect(nextSort({ key: "value", direction: "descending" }, "name")).toEqual({ key: "name", direction: "ascending" });
  });
});

describe("sortItems", () => {
  const rows: Row[] = [
    { name: "b", value: 2 },
    { name: "a", value: 10 },
    { name: "c", value: null },
    { name: "d", value: 1 },
  ];

  it("keeps the order when there is no sort", () => {
    expect(sortItems(rows, null, valueOf)).toBe(rows);
  });

  it("sorts numbers by value, not as text", () => {
    expect(sortItems(rows, { key: "value", direction: "ascending" }, valueOf).map((row) => row.value)).toEqual([1, 2, 10, null]);
  });

  it("keeps empty values last in both directions", () => {
    expect(sortItems(rows, { key: "value", direction: "descending" }, valueOf).map((row) => row.value)).toEqual([10, 2, 1, null]);
  });

  it("sorts text ignoring case and reading digits as numbers", () => {
    const texts: Row[] = [{ name: "item 10" }, { name: "Item 2" }, { name: "apple" }];
    expect(sortItems(texts, { key: "name", direction: "ascending" }, valueOf).map((row) => row.name)).toEqual(["apple", "Item 2", "item 10"]);
  });

  it("keeps equal values in their original order", () => {
    const ties: Row[] = [
      { name: "x", value: 1 },
      { name: "y", value: 1 },
      { name: "z", value: 1 },
    ];
    expect(sortItems(ties, { key: "value", direction: "descending" }, valueOf).map((row) => row.name)).toEqual(["x", "y", "z"]);
  });
});
