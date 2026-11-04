import { describe, expect, it } from "vite-plus/test";
import { parseFoundDerivatives, parseFoundSecurities } from "./discover";

describe("parseFoundSecurities", () => {
  it("reads quote data and drops duplicate ISINs in nested responses", () => {
    const result = {
      data: {
        results: [
          { isin: "US0378331005", name: "Apple Inc.", symbol: "AAPL", securityType: "STOCK", currentQuote: { midPrice: "190.5", currency: "USD", timestampUtc: "2026-10-30T12:00:00Z", isOutdated: true } },
          { isin: "us0378331005", name: "Duplicate" },
        ],
      },
    };
    expect(parseFoundSecurities(result)).toMatchObject([
      { isin: "US0378331005", name: "Apple Inc.", symbol: "AAPL", type: "STOCK", currency: "USD", lastPrice: 190.5, quoteAt: "2026-10-30T12:00:00Z", isOutdated: true },
    ]);
  });

  it("handles missing quote fields and JSON-encoded nested results", () => {
    expect(parseFoundSecurities({ response: JSON.stringify({ securities: [{ security: { isin: "DE0007164600", name: "SAP SE" } }] }) })).toMatchObject([
      { isin: "DE0007164600", name: "SAP SE", lastPrice: null, quoteAt: null, isOutdated: false },
    ]);
    expect(parseFoundSecurities(null)).toEqual([]);
  });
});

describe("parseFoundDerivatives", () => {
  it("builds product labels and formats leverage, strike, barrier and premium", () => {
    expect(
      parseFoundDerivatives({
        products: [
          {
            isin: "DE000A1B2C34",
            issuer: "Example Bank",
            productSubcategory: "Turbo call",
            strategy: "LONG",
            leverage: "4.5",
            strike: { amount: "100" },
            knockoutBarrier: 95.25,
            expiry: "OPEN_ENDED",
            premium: 12.5,
            currency: "EUR",
          },
        ],
      }),
    ).toMatchObject([
      {
        name: "Example Bank · Turbo call",
        strategy: "LONG",
        leverage: "4.5×",
        strike: "€100.00",
        knockoutBarrier: "€95.25",
        expiry: "Open end",
        premium: "€12.50",
      },
    ]);
  });

  it("keeps useful derivatives without an ISIN and tolerates sparse data", () => {
    expect(parseFoundDerivatives([{ issuer: "Issuer", productSubcategory: "Certificate" }])).toMatchObject([
      { isin: null, name: "Issuer · Certificate", strike: null, knockoutBarrier: null, expiry: null },
    ]);
    expect(parseFoundDerivatives({ results: [null, "invalid"] })).toEqual([]);
  });
});