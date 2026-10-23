import { describe, expect, it } from "vite-plus/test";
import { amountExceedsBuyingPower, amountIssue, decimalPlaces, holdingsByIsin, limitPriceHint, previewFailureHint, priceIssue, quantityExceedsHolding, stopPriceIssue } from "./order";

describe("order limits", () => {
  it("explains generic preview failures and suggests a venue next step", () => {
    expect(previewFailureHint("The request could not be completed.")).toContain("Try another venue (EIX, Gettex or Xetra)");
    expect(previewFailureHint("internal_error")).toContain("Try another venue");
    expect(previewFailureHint("Unsupported order type")).toBeNull();
  });

  it("blocks a buy above known buying power, but allows the exact balance", () => {
    expect(amountExceedsBuyingPower(100.01, 100)).toBe(true);
    expect(amountExceedsBuyingPower(100, 100)).toBe(false);
    expect(amountExceedsBuyingPower(100, null)).toBe(false);
  });

  it("blocks a sale above known holdings, but allows the held quantity", () => {
    expect(quantityExceedsHolding(1.01, 1)).toBe(true);
    expect(quantityExceedsHolding(1, 1)).toBe(false);
    expect(quantityExceedsHolding(1, null)).toBe(false);
  });

  it("counts decimal places, including exponent forms", () => {
    expect(decimalPlaces(12)).toBe(0);
    expect(decimalPlaces(12.3456)).toBe(4);
    expect(decimalPlaces(1.5e-7)).toBe(8);
    expect(decimalPlaces(1e21)).toBe(0);
    expect(decimalPlaces(Number.NaN)).toBe(0);
  });

  it("keeps amounts to cents and above the floor, and prices to the finest tick", () => {
    expect(amountIssue(1)).toBeNull();
    expect(amountIssue(0.99)).toMatch(/at least 1/);
    expect(amountIssue(10.005)).toMatch(/2 decimal places/);
    expect(priceIssue(123.4567)).toBeNull();
    expect(priceIssue(123.45678)).toMatch(/4 decimal places/);
  });

  it("blocks a stop on the market's side of the price and only hints for a marketable limit", () => {
    const format = (price: number) => `€${price}`;
    expect(stopPriceIssue("buy", 101, 100, format)).toBeNull();
    expect(stopPriceIssue("buy", 100, 100, format)).toContain("above the current price of €100");
    expect(stopPriceIssue("sell", 99, 100, format)).toBeNull();
    expect(stopPriceIssue("sell", 100, 100, format)).toContain("below the current price of €100");
    expect(stopPriceIssue("sell", 100, null, format)).toBeNull();
    expect(stopPriceIssue("sell", 100, 0, format)).toBeNull();
    expect(limitPriceHint("buy", 99, 100, format)).toBeNull();
    expect(limitPriceHint("buy", 100, 100, format)).toContain("fill right away");
    expect(limitPriceHint("sell", 101, 100, format)).toBeNull();
    expect(limitPriceHint("sell", 100, 100, format)).toContain("fill right away");
    expect(limitPriceHint("sell", 100, null, format)).toBeNull();
  });

  it("adds up rows of the same ISIN and ignores other portfolios and unknown quantities", () => {
    const held = holdingsByIsin(
      [
        { portfolioId: "a", isin: "X", quantity: 1.5 },
        { portfolioId: "a", isin: "X", quantity: 2 },
        { portfolioId: "b", isin: "X", quantity: 9 },
        { portfolioId: "a", isin: "Y", quantity: null },
      ],
      "a",
    );
    expect(held).toEqual({ X: 3.5 });
  });
});
