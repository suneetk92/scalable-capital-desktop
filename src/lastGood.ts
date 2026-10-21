import type { Dashboard, PortfolioSnapshot } from "./types";

type Entry = { outcome: { ok: boolean; error?: string } };

/**
 * What a query shows after it finished: the fresh entries when every call worked, else the entries of the last
 * good answer to the same question (marked stale, with the first error), else the failures themselves.
 */
export function withLastGood<E extends Entry>(fresh: E[], lastGood: E[] | null): { entries: E[]; staleError: string | null } {
  if (fresh.every((entry) => entry.outcome.ok)) return { entries: fresh, staleError: null };
  if (!lastGood) return { entries: fresh, staleError: null };
  return { entries: lastGood, staleError: fresh.find((entry) => !entry.outcome.ok)?.outcome.error ?? "The refresh failed." };
}

const isGood = (value: unknown, error: string | null | undefined) => value !== undefined && value !== null && !error;

const errorKeys = (groups: Record<string, unknown> | undefined) => Object.keys(groups ?? {}).filter((key) => key.endsWith(":error"));

/**
 * The reloaded dashboard with every part that failed this time replaced by what the previous dashboard had for it
 * (a portfolio's overview or cash, the watchlist, the groups), and the messages of those failures. A part with no
 * earlier good value keeps its error.
 */
export function keepLastGoodParts(previous: Dashboard | null, next: Dashboard): { dashboard: Dashboard; failures: string[] } {
  if (!previous) return { dashboard: next, failures: [] };
  const failures: string[] = [];
  const portfolios = next.portfolios.map((portfolio): PortfolioSnapshot => {
    const earlier = previous.portfolios.find((item) => item.portfolioId === portfolio.portfolioId);
    let kept = portfolio;
    if (portfolio.overviewError && earlier && isGood(earlier.overview, earlier.overviewError)) {
      failures.push(portfolio.overviewError);
      kept = { ...kept, overview: earlier.overview, overviewError: null };
    }
    if (portfolio.cashError && earlier && isGood(earlier.cash, earlier.cashError)) {
      failures.push(portfolio.cashError);
      kept = { ...kept, cash: earlier.cash, cashError: null };
    }
    return kept;
  });
  let dashboard: Dashboard = { ...next, portfolios };
  if (next.watchlistError && isGood(previous.watchlist, previous.watchlistError)) {
    failures.push(next.watchlistError);
    dashboard = { ...dashboard, watchlist: previous.watchlist, watchlistError: null, quotes: { ...previous.quotes, ...next.quotes } };
  }
  const failedGroups = errorKeys(next.groups);
  if (failedGroups.length > 0 && previous.groups && errorKeys(previous.groups).length === 0) {
    failures.push(...failedGroups.map((key) => String(next.groups?.[key])));
    dashboard = { ...dashboard, groups: previous.groups };
  }
  return { dashboard, failures };
}
