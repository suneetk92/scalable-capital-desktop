import { describe, expect, it } from "vitest";
import type { SecurityGroup } from "./groups";
import {
  cashFigures,
  csvCell,
  formatChange,
  formatMoney,
  groupHas,
  holdingRows,
  numericValue,
  overviewPerformance,
  portfolioCurrency,
  parseSearch,
  recordsFrom,
  splitHoldings,
  type ScreenerRow,
} from "./screener";

describe("holdingRows", () => {
  it("maps a holding with currentQuote.midPrice and position.filled", () => {
    const holdings = { securities: [{ isin: "US0378331005", name: "Apple Inc.", currentQuote: { midPrice: 190.5 }, position: { filled: 10 } }] };
    const [row] = holdingRows("pf-1", holdings);
    expect(row).toMatchObject({ isin: "US0378331005", name: "Apple Inc.", portfolioId: "pf-1", lastPrice: 190.5, quantity: 10, value: 1905, currency: "EUR" });
  });

  it("turns a quote's INTRADAY performance into the change percentage", () => {
    const holdings = [{ isin: "DE0001", name: "Example AG", position: { filled: 2 } }];
    const quotes = {
      DE0001: {
        midPrice: 50,
        performance: [
          { timeframe: "ONE_WEEK", performance: 0.5 },
          { timeframe: "INTRADAY", performance: 0.0125 },
        ],
      },
    };
    const [row] = holdingRows("pf-1", holdings, quotes);
    expect(row.change).toBeCloseTo(1.25, 6);
    expect(row.lastPrice).toBe(50);
    expect(row.value).toBe(100);
  });

  it("prefers the freshly fetched quote over the price stored in the holding", () => {
    const holdings = [{ isin: "DE0002", name: "Fresh AG", price: 10, quantity: 3 }];
    const [row] = holdingRows("pf-1", holdings, { DE0002: { midPrice: 12 } });
    expect(row.lastPrice).toBe(12);
    expect(row.value).toBe(36);
  });

  it("keeps only crypto holdings with a positive amount", () => {
    const holdings = {
      securities: [{ isin: "DE0003", name: "Stock", quantity: 1, price: 5 }],
      cryptoHoldings: [
        { name: "Bitcoin", symbol: "BTC", quantity: 0.5, price: 100 },
        { name: "Dogecoin", symbol: "DOGE", quantity: 0, price: 1 },
      ],
    };
    const rows = holdingRows("pf-1", holdings);
    expect(rows.map((row) => row.symbol)).toEqual(["DE0003", "BTC"]);
    expect(rows[1].exchange).toBe("CRYPTO");
  });
});

describe("splitHoldings", () => {
  it("separates the crypto list from the securities, also from a JSON string", () => {
    const result = splitHoldings(JSON.stringify({ items: [{ isin: "X" }], cryptoHoldings: [{ symbol: "ETH" }, 3] }));
    expect(result.crypto).toEqual([{ symbol: "ETH" }]);
    expect(result.securities).toEqual({ items: [{ isin: "X" }] });
  });
});

describe("recordsFrom", () => {
  it("unwraps nested arrays and wrapper keys", () => {
    const payload = { data: { results: [[{ symbol: "AAA" }], [{ symbol: "BBB" }]] } };
    expect(recordsFrom(payload).map((record) => record.symbol)).toEqual(["AAA", "BBB"]);
  });

  it("parses JSON strings and ignores unreadable input", () => {
    expect(recordsFrom('{"holdings":[{"isin":"I1"}]}')).toEqual([{ isin: "I1" }]);
    expect(recordsFrom("not json")).toEqual([]);
    expect(recordsFrom(null)).toEqual([]);
  });
});

describe("numericValue", () => {
  it("parses plain, localised and decorated strings", () => {
    expect(numericValue("42")).toBe(42);
    expect(numericValue("1.234,56 €")).toBe(1234.56);
    expect(numericValue("1,234.56")).toBe(1234.56);
    expect(numericValue("12,5")).toBe(12.5);
    expect(numericValue("-3.5%")).toBe(-3.5);
  });

  it("returns null for text and unwraps amount objects", () => {
    expect(numericValue("n/a")).toBeNull();
    expect(numericValue(Number.NaN)).toBeNull();
    expect(numericValue({ amount: "7,25", currency: "EUR" })).toBe(7.25);
  });
});

describe("formatters", () => {
  it("formatChange shows the sign for gains only and a dash for missing values", () => {
    expect(formatChange(null)).toBe("—");
    expect(formatChange(1.234)).toBe("+1.23%");
    expect(formatChange(-0.5)).toBe("-0.5%");
    expect(formatChange(0)).toBe("0%");
  });

  it("formatMoney formats currencies and falls back for unknown ones", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(1234.5)).toBe("€1,234.50");
    expect(formatMoney(1, "ZZZZ")).toBe("1.00 ZZZZ");
  });

  it("csvCell quotes separators, quotes and line breaks", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });
});

describe("overview helpers", () => {
  it("overviewPerformance keeps known timeframes with their labels", () => {
    const overview = {
      performance: [
        { timeframe: "INTRADAY", simpleAbsoluteReturn: "12.5" },
        { timeframe: "ONE_YEAR", simpleAbsoluteReturn: -40 },
        { timeframe: "UNKNOWN", simpleAbsoluteReturn: 1 },
      ],
    };
    expect([...overviewPerformance(overview)]).toEqual([
      ["Today", 12.5],
      ["1 year", -40],
    ]);
  });

  it("cashFigures reads balance, buying power and credit line", () => {
    expect(cashFigures({ cashBalance: 100, buyingPower: "250,5", availableCreditLine: 0 })).toEqual({ balance: 100, buyingPower: 250.5, credit: 0 });
    expect(cashFigures(undefined)).toEqual({ balance: null, buyingPower: null, credit: null });
  });

  it("reads the portfolio currency for order sizing, falling back to cash", () => {
    expect(portfolioCurrency({ currency: "USD" }, { currency: "EUR", buyingPower: 250 })).toBe("USD");
    expect(portfolioCurrency(null, { currency: "EUR" })).toBe("EUR");
    expect(portfolioCurrency({ currency: "eur" }, null)).toBeNull();
  });
});

describe("groupHas and parseSearch", () => {
  const row = { isin: "DE0001", portfolioId: "pf-1" } as ScreenerRow;

  it("groupHas matches by ISIN or by whole portfolio", () => {
    expect(groupHas({ isins: ["DE0001"], portfolioIds: [] } as unknown as SecurityGroup, row)).toBe(true);
    expect(groupHas({ isins: [], portfolioIds: ["pf-1"] } as unknown as SecurityGroup, row)).toBe(true);
    expect(groupHas({ isins: ["OTHER"], portfolioIds: ["pf-2"] } as unknown as SecurityGroup, row)).toBe(false);
  });

  it("parseSearch returns each ISIN once", () => {
    const hits = parseSearch({ results: [{ isin: "A1", name: "One" }, { isin: "A1", name: "One again" }, { isin: "B2", name: "Two", currency: "USD" }, { name: "No isin" }] });
    expect(hits.map((hit) => hit.isin)).toEqual(["A1", "B2"]);
    expect(hits[1]).toMatchObject({ name: "Two", currency: "USD" });
  });
});

describe("sinceBuy", () => {
  it("uses the figure Scalable reports, else works it out from the average price", () => {
    const [reported] = holdingRows("p1", [{ isin: "DE0001", name: "A", quantity: 2, price: 10, performance: { sinceBuy: { simpleAbsoluteReturn: -5, performance: -0.2 } } }]);
    expect(reported.sinceBuy).toBe(-5);
    const [worked] = holdingRows("p1", [{ isin: "DE0002", name: "B", quantity: 2, price: 10, averagePrice: 8 }]);
    expect(worked.sinceBuy).toBe(4);
    const [fromPercent] = holdingRows("p1", [{ isin: "DE0004", name: "D", quantity: 2, price: 10, performance: { sinceBuy: { performance: -0.2 } } }]);
    expect(fromPercent.sinceBuy).toBeCloseTo(-5);
    const [byName] = holdingRows("p1", [{ isin: "DE0005", name: "E", quantity: 2, price: 10, position: { totalReturn: { amount: 3 } } }]);
    expect(byName.sinceBuy).toBe(3);
    const [byCost] = holdingRows("p1", [{ isin: "DE0006", name: "F", quantity: 2, price: 10, buyInValueTotal: 15 }]);
    expect(byCost.sinceBuy).toBe(5);
    const [unknown] = holdingRows("p1", [{ isin: "DE0003", name: "C", quantity: 2, price: 10 }]);
    expect(unknown.sinceBuy).toBeNull();
    const [fromList] = holdingRows("p1", [
      {
        isin: "DE0005",
        name: "E",
        quantity: 2,
        price: 10,
        performance: [
          { timeframe: "ONE_WEEK", simpleAbsoluteReturn: 1 },
          { timeframe: "SINCE_BUY", simpleAbsoluteReturn: 8 },
        ],
      },
    ]);
    expect(fromList.sinceBuy).toBe(8);
  });
});

describe("cost, average price and gain percent", () => {
  it("works the cost and the average price out from a reported average price", () => {
    const [row] = holdingRows("p1", [{ isin: "DE0002", name: "B", quantity: 2, price: 10, averagePrice: 8 }]);
    expect(row).toMatchObject({ avgPrice: 8, cost: 16, sinceBuy: 4, sinceBuyPct: 25 });
  });

  it("works the average price out from the gain when only that is reported", () => {
    const [row] = holdingRows("p1", [{ isin: "DE0001", name: "A", quantity: 4, price: 10, performance: { sinceBuy: { simpleAbsoluteReturn: -10 } } }]);
    expect(row).toMatchObject({ cost: 50, avgPrice: 12.5, sinceBuy: -10, sinceBuyPct: -20 });
  });

  it("leaves them empty when Scalable gives no cost", () => {
    const [row] = holdingRows("p1", [{ isin: "DE0003", name: "C", quantity: 2, price: 10 }]);
    expect(row).toMatchObject({ avgPrice: null, cost: null, sinceBuyPct: null });
  });
});

describe("bid, ask and spread", () => {
  it("reads them from the fresh quote", () => {
    const [row] = holdingRows("p1", [{ isin: "DE0001000001", name: "A", quantity: 1 }], { DE0001000001: { bidPrice: 99, askPrice: 101, midPrice: 100 } });
    expect(row).toMatchObject({ bid: 99, ask: 101 });
    expect(row.spreadPct).toBeCloseTo(2);
  });

  it("leaves them empty without a quote", () => {
    const [row] = holdingRows("p1", [{ isin: "DE0001000001", name: "A", quantity: 1, price: 10 }]);
    expect(row).toMatchObject({ bid: null, ask: null, spreadPct: null });
  });
});
