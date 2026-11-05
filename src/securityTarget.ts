import type { ScreenerRow } from "./screener";
import type { DrawerTarget } from "./SecurityDrawer";

/**
 * The figures of the security details panel, read from the rows the dashboard has now. A panel that stays
 * open across a reload follows the price, the holding and the watchlist, instead of keeping the numbers the
 * security was opened with. The identity (ISIN, name, symbol, currency, portfolio) stays as it was opened.
 */
export function refreshSecurityTarget(target: DrawerTarget, held: ScreenerRow[], watched: ScreenerRow[], watchlistUnknown: boolean): DrawerTarget {
  // The same ISIN can be held in several portfolios: the holding is the one in the portfolio the panel was opened
  // for. A security opened from a search result has no portfolio, so any holding of it counts.
  const holding = held.find((row) => row.isin === target.isin && (!target.portfolioId || row.portfolioId === target.portfolioId));
  const live = holding ?? watched.find((row) => row.isin === target.isin);
  return {
    ...target,
    // A security opened from a search result has no row of its own; the price it was opened with stays the last known one.
    lastPrice: live?.lastPrice ?? target.lastPrice,
    change: live?.change ?? target.change,
    // Holdings that could not be read fail the whole reload in the backend, so a missing row means the
    // portfolio no longer holds the security, not that its holdings are unknown.
    quantity: holding?.quantity ?? null,
    inWatchlist: watchlistUnknown ? null : watched.some((row) => row.isin === target.isin),
  };
}
