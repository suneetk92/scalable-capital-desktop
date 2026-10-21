import { describe, expect, it } from "vitest";
import { keepLastGoodParts, withLastGood } from "./lastGood";
import type { Dashboard, PortfolioSnapshot } from "./types";

const ok = (value: string) => ({ semantic: {}, outcome: { name: "t", ok: true, result: value } });
const bad = (error: string) => ({ semantic: {}, outcome: { name: "t", ok: false, error } });

describe("withLastGood", () => {
  it("shows fresh entries when every call worked", () => {
    expect(withLastGood([ok("new")], [ok("old")])).toEqual({ entries: [ok("new")], staleError: null });
  });

  it("keeps the last good entries when a call failed, and says why", () => {
    expect(withLastGood([ok("new"), bad("Rate limited")], [ok("old")])).toEqual({ entries: [ok("old")], staleError: "Rate limited" });
  });

  it("shows the failure when there is nothing earlier", () => {
    expect(withLastGood([bad("Down")], null)).toEqual({ entries: [bad("Down")], staleError: null });
  });
});

const portfolio = (patch: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot => ({
  portfolioId: "p1",
  name: "Main",
  portfolio: {},
  holdings: [],
  overview: { value: 1 },
  cash: { free: 2 },
  ...patch,
});
const dashboard = (patch: Partial<Dashboard> = {}): Dashboard => ({ authenticated: true, portfolios: [portfolio()], watchlist: [{ isin: "A" }], quotes: { A: 1 }, groups: { list: [1] }, ...patch });

describe("keepLastGoodParts", () => {
  it("returns the new dashboard as it is when nothing failed or nothing came before", () => {
    const next = dashboard();
    expect(keepLastGoodParts(dashboard(), next)).toEqual({ dashboard: next, failures: [] });
    expect(keepLastGoodParts(null, dashboard({ watchlistError: "x" })).failures).toEqual([]);
  });

  it("keeps the earlier overview and cash of a portfolio whose reload failed", () => {
    const next = dashboard({ portfolios: [portfolio({ overview: undefined, overviewError: "Overview down", cash: undefined, cashError: "Cash down" })] });
    const result = keepLastGoodParts(dashboard(), next);
    expect(result.dashboard.portfolios[0]).toMatchObject({ overview: { value: 1 }, overviewError: null, cash: { free: 2 }, cashError: null });
    expect(result.failures).toEqual(["Overview down", "Cash down"]);
  });

  it("keeps the earlier watchlist and its quotes when the watchlist failed", () => {
    const result = keepLastGoodParts(dashboard(), dashboard({ watchlist: [], watchlistError: "Watchlist down", quotes: { B: 2 } }));
    expect(result.dashboard.watchlist).toEqual([{ isin: "A" }]);
    expect(result.dashboard.watchlistError).toBeNull();
    expect(result.dashboard.quotes).toEqual({ A: 1, B: 2 });
    expect(result.failures).toEqual(["Watchlist down"]);
  });

  it("keeps the earlier groups when a groups call failed", () => {
    const result = keepLastGoodParts(dashboard(), dashboard({ groups: { "p1:error": "Groups down" } }));
    expect(result.dashboard.groups).toEqual({ list: [1] });
    expect(result.failures).toEqual(["Groups down"]);
  });

  it("keeps an error that has no earlier good value to fall back on", () => {
    const earlier = dashboard({ watchlist: [], watchlistError: "was down", portfolios: [portfolio({ overview: undefined, overviewError: "was down" })] });
    const next = dashboard({ watchlistError: "still down", portfolios: [portfolio({ overview: undefined, overviewError: "still down" })] });
    const result = keepLastGoodParts(earlier, next);
    expect(result.dashboard.watchlistError).toBe("still down");
    expect(result.dashboard.portfolios[0]?.overviewError).toBe("still down");
    expect(result.failures).toEqual([]);
  });

  it("does not take the parts of a portfolio that is new", () => {
    const next = dashboard({ portfolios: [portfolio({ portfolioId: "p2", overview: undefined, overviewError: "down" })] });
    expect(keepLastGoodParts(dashboard(), next).dashboard.portfolios[0]?.overviewError).toBe("down");
  });
});
