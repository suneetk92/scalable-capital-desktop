import { describe, expect, it } from "vite-plus/test";
import { dedupeRows, distinctValues, isFiltering, matchesFilter, newestFirst, NO_FILTER, withCancelledOrders, type TransactionRow } from "./transactions";

const row = (id: string | undefined, portfolioId = "p1"): TransactionRow => ({ record: id === undefined ? { note: "x" } : { transactionId: id }, portfolioId });
const ids = (rows: TransactionRow[] | null) => rows?.map((item) => (item.record as { transactionId?: string }).transactionId);

describe("transactions", () => {
  it("lists each transaction once and keeps rows without an id", () => {
    expect(ids(dedupeRows([row("a"), row("b"), row("a"), row("a", "p2"), row(undefined), row(undefined)]))).toEqual(["a", "b", "a", undefined, undefined]);
  });

  it("sorts newest first across portfolios and keeps undated rows last in order", () => {
    const dated = (id: string, lastEventAt?: string, portfolioId = "p1"): TransactionRow => ({ record: { transactionId: id, ...(lastEventAt ? { lastEventAt } : {}) }, portfolioId });
    const sorted = newestFirst([dated("old", "2024-01-01T10:00:00Z"), dated("none1"), dated("new", "2025-03-01T09:00:00Z", "p2"), dated("mid", "2024-06-01T00:00:00Z"), dated("none2")]);
    expect(ids(sorted)).toEqual(["new", "mid", "old", "none1", "none2"]);
  });

  it("filters by type, status and a text that matches the ISIN or the name", () => {
    const buy = { kind: "BUY", status: "SETTLED", isin: "US0378331005", name: "Apple" };
    expect(matchesFilter(buy, NO_FILTER)).toBe(true);
    expect(matchesFilter(buy, { ...NO_FILTER, kind: "buy" })).toBe(true);
    expect(matchesFilter(buy, { ...NO_FILTER, kind: "SELL" })).toBe(false);
    expect(matchesFilter(buy, { ...NO_FILTER, status: "Settled" })).toBe(true);
    expect(matchesFilter(buy, { ...NO_FILTER, status: "CANCELLED" })).toBe(false);
    expect(matchesFilter(buy, { ...NO_FILTER, text: " us0378 " })).toBe(true);
    expect(matchesFilter(buy, { ...NO_FILTER, text: "APP" })).toBe(true);
    expect(matchesFilter(buy, { ...NO_FILTER, text: "tesla" })).toBe(false);
    expect(matchesFilter(buy, { text: "apple", kind: "BUY", status: "SETTLED" })).toBe(true);
    expect(matchesFilter(buy, { text: "apple", kind: "BUY", status: "CANCELLED" })).toBe(false);
  });

  it("does not match a status or text a transaction does not have", () => {
    const cash = { kind: "DEPOSIT" };
    expect(matchesFilter(cash, { ...NO_FILTER, status: "SETTLED" })).toBe(false);
    expect(matchesFilter(cash, { ...NO_FILTER, text: "x" })).toBe(false);
    expect(matchesFilter(cash, NO_FILTER)).toBe(true);
  });

  it("knows when a filter is set and lists distinct option values", () => {
    expect(isFiltering(NO_FILTER)).toBe(false);
    expect(isFiltering({ ...NO_FILTER, text: "  " })).toBe(false);
    expect(isFiltering({ ...NO_FILTER, status: "SETTLED" })).toBe(true);
    expect(distinctValues(["SELL", "BUY", undefined, "", "buy", "DEPOSIT"])).toEqual(["BUY", "DEPOSIT", "SELL"]);
  });
});

describe("withCancelledOrders", () => {
  it("marks the cancelled orders that a sync still read as open, and keeps a status that moved on", () => {
    const records = [
      { id: "o1", status: "PENDING" },
      { id: "o2", status: "FILLED" },
      { orderId: "o3", status: "OPEN" },
      { id: "o4", status: "PENDING" },
    ];
    expect(withCancelledOrders(records, ["o1", "o2", "o3"]).map((record) => record.status)).toEqual(["CANCELLED", "FILLED", "CANCELLED", "PENDING"]);
  });
});
