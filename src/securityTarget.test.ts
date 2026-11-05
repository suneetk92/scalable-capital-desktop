import { describe, expect, it } from "vite-plus/test";
import { refreshSecurityTarget } from "./securityTarget";
import type { ScreenerRow } from "./screener";
import type { DrawerTarget } from "./SecurityDrawer";

const row = (over: Partial<ScreenerRow>): ScreenerRow => ({
  rowId: "a",
  symbol: "A",
  isin: "DE0000000001",
  portfolioId: "p1",
  name: "A",
  exchange: "",
  lastPrice: 10,
  change: 1,
  quantity: 2,
  value: 20,
  currency: "EUR",
  keys: [],
  ...over,
});

const target = (over: Partial<DrawerTarget> = {}): DrawerTarget => ({
  isin: "DE0000000001",
  name: "A",
  symbol: "A",
  currency: "EUR",
  lastPrice: 4,
  change: -2,
  portfolioId: "p1",
  quantity: 500,
  inWatchlist: false,
  ...over,
});

describe("refreshSecurityTarget", () => {
  it("follows the price, the change and the holding of the security that is still open", () => {
    const refreshed = refreshSecurityTarget(target(), [row({ lastPrice: 11.5, change: 3.5, quantity: 400 })], [], false);
    expect(refreshed).toMatchObject({ lastPrice: 11.5, change: 3.5, quantity: 400 });
  });

  it("keeps the identity and the portfolio the security was opened with", () => {
    const refreshed = refreshSecurityTarget(target({ portfolioId: "p2", name: "As typed" }), [row({ portfolioId: "p1", name: "A" })], [], false);
    expect(refreshed).toMatchObject({ isin: "DE0000000001", name: "As typed", symbol: "A", currency: "EUR", portfolioId: "p2" });
  });

  it("takes the holding of the portfolio the security was opened from when several portfolios hold it", () => {
    const held = [row({ portfolioId: "p1", quantity: 2, lastPrice: 10 }), row({ portfolioId: "p2", quantity: 7, lastPrice: 10.5 })];
    expect(refreshSecurityTarget(target({ portfolioId: "p2" }), held, [], false)).toMatchObject({ portfolioId: "p2", quantity: 7, lastPrice: 10.5 });
    expect(refreshSecurityTarget(target({ portfolioId: "p3" }), held, [], false)).toMatchObject({ portfolioId: "p3", quantity: null });
  });

  it("takes any holding of a security opened from a search result", () => {
    expect(refreshSecurityTarget(target({ portfolioId: "" }), [row({ portfolioId: "p2", quantity: 7 })], [], false)).toMatchObject({ portfolioId: "", quantity: 7 });
  });

  it("says a security is no longer held once the position is gone", () => {
    expect(refreshSecurityTarget(target(), [], [], false)).toMatchObject({ quantity: null });
  });

  it("takes the figures of a watched security from the watchlist rows", () => {
    const refreshed = refreshSecurityTarget(target(), [], [row({ lastPrice: 7, change: -1 })], false);
    expect(refreshed).toMatchObject({ lastPrice: 7, change: -1, inWatchlist: true });
  });

  it("keeps the price it was opened with when the account has no row for it", () => {
    expect(refreshSecurityTarget(target({ isin: "XS9" }), [row({ isin: "DE0000000002" })], [row({ isin: "DE0000000003" })], false)).toMatchObject({ lastPrice: 4, change: -2, quantity: null });
  });

  it("leaves the watchlist state unknown while the watchlist could not be loaded", () => {
    expect(refreshSecurityTarget(target({ inWatchlist: null }), [], [], true)).toMatchObject({ inWatchlist: null });
  });
});
