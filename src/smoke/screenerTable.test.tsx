// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { useScreenerTable } from "../hooks/useScreenerTable";
import type { SecurityGroup } from "../groups";
import type { ScreenerRow } from "../screener";

const row = (symbol: string, lastPrice: number | null): ScreenerRow => ({
  rowId: `p-${symbol}`,
  symbol,
  isin: `ISIN-${symbol}`,
  portfolioId: "p",
  name: symbol,
  exchange: "Stock",
  lastPrice,
  change: null,
  quantity: 1,
  value: null,
  currency: "EUR",
  keys: [],
});

const portfolioRows = [row("B", 20), row("A", null), row("C", 10)];
const marketRecords = new Map();
const columns = ["price"];

beforeEach(() => localStorage.clear());

function setup() {
  return renderHook(() => useScreenerTable({ view: "portfolio", portfolioRows, watchlistRows: [], groups: [], pageSize: 10, columns, marketRecords }));
}

describe("useScreenerTable", () => {
  it("sorts by symbol first, then by a column: highest first, missing values last", () => {
    const { result } = setup();
    expect(result.current.visibleRows.map((item) => item.symbol)).toEqual(["A", "B", "C"]);
    act(() => result.current.toggleSort("price"));
    expect(result.current.visibleRows.map((item) => item.symbol)).toEqual(["B", "C", "A"]);
    expect(result.current.sortDirection).toBe("descending");
    act(() => result.current.toggleSort("price"));
    expect(result.current.visibleRows.map((item) => item.symbol)).toEqual(["A", "C", "B"]);
  });

  it("selects rows and the whole page by row id", () => {
    const { result } = setup();
    act(() => result.current.toggleRow("p-A", true));
    expect([...result.current.selected]).toEqual(["p-A"]);
    act(() => result.current.togglePage(true));
    expect(result.current.pageSelected).toBe(true);
    act(() => result.current.toggleRow("p-A", false));
    expect(result.current.selectedRows.map((item) => item.symbol)).toEqual(["B", "C"]);
    act(() => result.current.setSelected(new Set()));
    expect(result.current.selected.size).toBe(0);
  });

  it("keeps Portfolio and Watchlist search and filters independent", () => {
    const rows = [
      { ...row("A", 10), change: 1 },
      { ...row("B", 20), change: -1 },
    ];
    const useTables = () => ({
      portfolio: useScreenerTable({ view: "portfolio", portfolioRows: rows, watchlistRows: rows, groups: [], pageSize: 10, columns, marketRecords }),
      watchlist: useScreenerTable({ view: "watchlist", portfolioRows: rows, watchlistRows: rows, groups: [], pageSize: 10, columns, marketRecords }),
    });
    const { result } = renderHook(useTables);

    act(() => {
      result.current.portfolio.setQuery("A");
      result.current.portfolio.setChangeFilter("gainers");
    });
    expect(result.current.portfolio.visibleRows.map((item) => item.symbol)).toEqual(["A"]);
    expect(result.current.watchlist.query).toBe("");
    expect(result.current.watchlist.changeFilter).toBe("all");
    expect(result.current.watchlist.visibleRows.map((item) => item.symbol)).toEqual(["A", "B"]);

    act(() => {
      result.current.watchlist.setQuery("B");
      result.current.watchlist.setChangeFilter("losers");
    });
    expect(result.current.watchlist.visibleRows.map((item) => item.symbol)).toEqual(["B"]);
    expect(result.current.portfolio.query).toBe("A");
    expect(result.current.portfolio.changeFilter).toBe("gainers");
    expect(result.current.portfolio.visibleRows.map((item) => item.symbol)).toEqual(["A"]);
  });

  it("restores search and filters when the table is mounted again", () => {
    const rows = [
      { ...row("A", 10), change: 1 },
      { ...row("B", 20), change: -1 },
    ];
    const first = renderHook(() => useScreenerTable({ view: "portfolio", portfolioRows: rows, watchlistRows: [], groups: [], pageSize: 10, columns, marketRecords }));
    act(() => {
      first.result.current.setQuery("A");
      first.result.current.setChangeFilter("gainers");
    });
    first.unmount();

    const restored = renderHook(() => useScreenerTable({ view: "portfolio", portfolioRows: rows, watchlistRows: [], groups: [], pageSize: 10, columns, marketRecords }));
    expect(restored.result.current.query).toBe("A");
    expect(restored.result.current.changeFilter).toBe("gainers");
    expect(restored.result.current.visibleRows.map((item) => item.symbol)).toEqual(["A"]);
  });

  it("pages every group on its own, so all groups stay visible", () => {
    const many = Array.from({ length: 5 }, (_, index) => ({ ...row(`G${index}`, 1), isin: `G${index}` }));
    const rows = [...many, row("X", 1), row("Y", 1)];
    const group = { id: "g", name: "Big", isins: many.map((item) => item.isin), portfolioIds: [], isDefault: false } as unknown as SecurityGroup;
    const rest = { id: "d", name: "Default", isins: [], portfolioIds: [], isDefault: true } as unknown as SecurityGroup;
    const { result } = renderHook(() => useScreenerTable({ view: "portfolio", portfolioRows: rows, watchlistRows: [], groups: [group, rest], pageSize: 3, columns, marketRecords }));
    const kinds = () => result.current.tableItems.map((item) => (item.kind === "row" ? item.row.symbol : item.kind));
    expect(kinds()).toEqual(["header", "G0", "G1", "G2", "pager", "header", "X", "Y"]);
    act(() => result.current.setSectionPage("g", 2));
    expect(kinds()).toEqual(["header", "G3", "G4", "pager", "header", "X", "Y"]);
  });
});
