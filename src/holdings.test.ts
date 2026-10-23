import { describe, expect, it } from "vite-plus/test";
import { summarizeHoldings } from "./holdings";
import type { ScreenerRow } from "./screener";

/** A holdings row as `holdingRows` makes it: the cost and the gain percent follow from the value and the gain. */
const row = (over: Partial<ScreenerRow>): ScreenerRow => {
  const base: ScreenerRow = {
    rowId: "a",
    symbol: "A",
    isin: "DE0000000001",
    portfolioId: "p",
    name: "A",
    exchange: "",
    lastPrice: 10,
    change: 0,
    quantity: 1,
    value: 100,
    currency: "EUR",
    keys: [],
    ...over,
  };
  const { value, sinceBuy } = base;
  const cost = base.cost !== undefined ? base.cost : value !== null && sinceBuy != null ? value - sinceBuy : null;
  const avgPrice = base.avgPrice !== undefined ? base.avgPrice : cost !== null && base.quantity ? cost / base.quantity : null;
  const sinceBuyPct = sinceBuy != null && cost !== null && cost > 0 ? (sinceBuy / cost) * 100 : null;
  return { ...base, cost, avgPrice, sinceBuyPct };
};

describe("summarizeHoldings", () => {
  it("adds up value, cost, gain and the move today", () => {
    const summary = summarizeHoldings([row({ rowId: "a", value: 1100, sinceBuy: 100, change: 10 }), row({ rowId: "b", isin: "B", name: "B", value: 900, sinceBuy: -100, change: -10 })]);
    expect(summary.value).toBe(2000);
    expect(summary.cost).toBe(2000);
    expect(summary.gain).toBe(0);
    expect(summary.gainFraction).toBe(0);
    expect(summary.today).toBeCloseTo(100 - 100);
    expect(summary.positions.map((position) => position.rowId)).toEqual(["a", "b"]);
    expect(summary.positions[0].weight).toBeCloseTo(0.55);
  });

  it("counts only holdings with a known cost in the gain and says how many", () => {
    const summary = summarizeHoldings([row({ rowId: "a", value: 600, sinceBuy: 100 }), row({ rowId: "b", value: 400, sinceBuy: null })]);
    expect(summary.count).toBe(2);
    expect(summary.withCost).toBe(1);
    expect(summary.cost).toBe(500);
    expect(summary.gain).toBe(100);
    expect(summary.gainFraction).toBeCloseTo(0.2);
    expect(summary.positions[1].gain).toBeNull();
  });

  it("gives each position its cost and average buy price", () => {
    const summary = summarizeHoldings([
      row({ rowId: "a", value: 1100, quantity: 10, sinceBuy: 100 }),
      row({ rowId: "b", value: 500, quantity: 5, sinceBuy: 0, cost: 450, avgPrice: 90 }),
      row({ rowId: "c", value: 400, quantity: null, sinceBuy: null }),
    ]);
    const [a, b, c] = ["a", "b", "c"].map((id) => summary.positions.find((position) => position.rowId === id));
    expect(a?.cost).toBe(1000);
    expect(a?.avgPrice).toBe(100);
    expect(b?.cost).toBe(450);
    expect(b?.avgPrice).toBe(90);
    expect(c?.cost).toBeNull();
    expect(c?.avgPrice).toBeNull();
  });

  it("picks the best and the worst position by return", () => {
    const summary = summarizeHoldings([row({ rowId: "a", value: 120, sinceBuy: 20 }), row({ rowId: "b", value: 50, sinceBuy: -50 }), row({ rowId: "c", value: 110, sinceBuy: 10 })]);
    expect(summary.best?.rowId).toBe("a");
    expect(summary.worst?.rowId).toBe("b");
  });

  it("leaves out rows without a value and handles an empty list", () => {
    const summary = summarizeHoldings([row({ value: null }), row({ rowId: "z", value: 0 })], "USD");
    expect(summary.count).toBe(0);
    expect(summary.currency).toBe("USD");
    expect(summary.gainFraction).toBeNull();
    expect(summary.todayFraction).toBeNull();
    expect(summary.best).toBeNull();
  });

  it("shares the value among the five largest positions", () => {
    const rows = [50, 20, 10, 10, 5, 5].map((value, index) => row({ rowId: String(index), value }));
    expect(summarizeHoldings(rows).topFiveShare).toBeCloseTo(0.95);
  });

  it("flags totals that combine more than one currency", () => {
    expect(summarizeHoldings([row({ rowId: "eur", currency: "EUR" }), row({ rowId: "usd", currency: "USD" })]).mixedCurrencies).toBe(true);
    expect(summarizeHoldings([row({ currency: "EUR" })]).mixedCurrencies).toBe(false);
  });
});
