import { describe, expect, it } from "vite-plus/test";
import { isMainPortfolio, pagePortfolios } from "./portfolios";

describe("isMainPortfolio", () => {
  it("reads boolean flags and type labels", () => {
    expect(isMainPortfolio({ isMain: true })).toBe(true);
    expect(isMainPortfolio({ portfolio_type: "x", type: "MAIN" })).toBe(true);
    expect(isMainPortfolio({ isDefault: false, type: "SAVINGS" })).toBe(false);
    expect(isMainPortfolio(undefined)).toBe(false);
  });
});

describe("pagePortfolios", () => {
  const snap = (portfolioId: string, portfolio: unknown = {}) => ({ portfolioId, name: `P ${portfolioId}`, portfolio });
  it("puts the marked main portfolio first", () => {
    expect(pagePortfolios([snap("a"), snap("b", { isMain: true }), snap("c")]).map((item) => item.portfolioId)).toEqual(["b", "a", "c"]);
  });
  it("keeps the order when none is marked", () => {
    expect(pagePortfolios([snap("a"), snap("b")]).map((item) => item.portfolioId)).toEqual(["a", "b"]);
  });
});
