import { rowFromRecord } from "./screener";
import { withoutRecords } from "./tools";
import type { Dashboard } from "./types";
import { TOOL } from "./commands";

/** What a successful write changes in the dashboard data, so only that part is updated and not the whole dashboard. */
type DashboardEffect = "watchlist-add" | "watchlist-remove" | "groups" | "none" | "all";

export function dashboardEffect(tool: string): DashboardEffect {
  if (tool === TOOL.addWatchlistItem) return "watchlist-add";
  if (tool === TOOL.removeWatchlistItem) return "watchlist-remove";
  if (tool.includes("group")) return "groups";
  // Alerts and savings plans are separate lists that are updated where they are shown.
  if (tool.includes("price_alert") || tool.includes("savings_plan")) return "none";
  // A cancelled order is marked in the transaction history where it is shown.
  if (tool === TOOL.cancelOrder) return "none";
  return "all";
}

export function withoutWatchlistItem(dashboard: Dashboard, isin: string): Dashboard {
  return { ...dashboard, watchlist: withoutRecords(dashboard.watchlist, (record) => rowFromRecord(record, 0, "watch").isin === isin) };
}
