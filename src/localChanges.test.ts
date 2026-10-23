import { describe, expect, it } from "vite-plus/test";
import { dashboardEffect, withoutWatchlistItem } from "./localChanges";
import type { Dashboard } from "./types";

const dashboard = (watchlist: unknown): Dashboard => ({ authenticated: true, portfolios: [], watchlist });

describe("dashboardEffect", () => {
  it("limits each write to the part it changes", () => {
    expect(dashboardEffect("add_watchlist_item")).toBe("watchlist-add");
    expect(dashboardEffect("remove_watchlist_item")).toBe("watchlist-remove");
    expect(dashboardEffect("add_portfolio_group_holdings")).toBe("groups");
    expect(dashboardEffect("create_price_alert")).toBe("none");
    expect(dashboardEffect("remove_savings_plan")).toBe("none");
    expect(dashboardEffect("cancel_order")).toBe("none");
    expect(dashboardEffect("submit_buy_order")).toBe("all");
  });
});

describe("withoutWatchlistItem", () => {
  it("drops the security from the list and keeps the rest", () => {
    const list = [
      { isin: "US0378331005", name: "Apple" },
      { isin: "DE0007164600", name: "SAP" },
    ];
    expect(withoutWatchlistItem(dashboard(list), "US0378331005").watchlist).toEqual([{ isin: "DE0007164600", name: "SAP" }]);
    expect(withoutWatchlistItem(dashboard({ items: list }), "DE0007164600").watchlist).toEqual({ items: [list[0]] });
  });
});
