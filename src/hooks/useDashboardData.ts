import { useMemo } from "react";
import { orderGroups, parseGroupData, ungroupedGroup, type SecurityGroup } from "../groups";
import { dataIssueMessages, holdingRows, overviewTotal, recordsFrom, rowFromRecord, summarizeOverview, type ScreenerRow } from "../screener";
import type { Dashboard } from "../types";

/** The value and the Since buy figures summed from holding rows; `reported` keeps what Scalable already gave. */
function figuresOf(rows: ScreenerRow[], reported: SecurityGroup | null) {
  const withGain = rows.filter((row) => row.sinceBuy !== null && row.sinceBuy !== undefined);
  const gain = withGain.length > 0 ? withGain.reduce((sum, row) => sum + (row.sinceBuy ?? 0), 0) : null;
  const cost = withGain.reduce((sum, row) => sum + (row.value ?? 0) - (row.sinceBuy ?? 0), 0);
  return {
    valuation: reported?.valuation ?? rows.reduce((sum, row) => sum + (row.value ?? 0), 0),
    currency: reported?.valuation != null ? reported.currency : rows[0].currency || reported?.currency || "EUR",
    sinceBuyAbsolute: reported?.sinceBuyAbsolute ?? gain,
    sinceBuyPerformance: reported?.sinceBuyPerformance ?? (gain !== null && cost > 0 ? gain / cost : null),
  };
}

/** Everything the screens show that is derived from the loaded dashboard: rows, groups, totals and notices. */
export function useDashboardData(dashboard: Dashboard | null, showDiagnostics: boolean, groupOrder: readonly string[]) {
  const portfolioRows = useMemo(() => {
    if (!dashboard) return [];
    return dashboard.portfolios.flatMap((portfolio) => holdingRows(portfolio.portfolioId, portfolio.holdings, dashboard.quotes));
  }, [dashboard]);

  const watchlistRows = useMemo(() => {
    if (!dashboard) return [];
    const held = new Map<string, { quantity: number; value: number | null }>();
    for (const row of portfolioRows) {
      if (!row.isin) continue;
      const entry = held.get(row.isin) ?? { quantity: 0, value: null };
      entry.quantity += row.quantity ?? 0;
      if (row.value !== null) entry.value = (entry.value ?? 0) + row.value;
      held.set(row.isin, entry);
    }
    return recordsFrom(dashboard.watchlist).map((record, index) => {
      const row = rowFromRecord(record, index, "watch", dashboard.quotes);
      const position = row.isin ? held.get(row.isin) : undefined;
      return position && row.value === null ? { ...row, value: position.value } : row;
    });
  }, [dashboard, portfolioRows]);

  // The groups follow the order the user dragged them to on every page that lists them.
  const groupData = useMemo(() => {
    const parsed = parseGroupData(dashboard?.groups);
    return { ...parsed, groups: orderGroups(parsed.groups, groupOrder) };
  }, [dashboard, groupOrder]);
  // A group Scalable reports no value or Since buy for gets them from its holdings' rows.
  const groups = useMemo(
    () =>
      groupData.groups.map((group) => {
        if (group.valuation !== null && group.sinceBuyAbsolute !== null) return group;
        const members = portfolioRows.filter((row) => row.isin !== "" && group.isins.includes(row.isin) && row.value !== null);
        return members.length === 0 ? group : { ...group, ...figuresOf(members, group) };
      }),
    [groupData, portfolioRows],
  );
  // The default group is worked out from the portfolio rows, as Scalable reports no figures for it.
  const defaultGroup = useMemo(() => {
    const group = ungroupedGroup(groupData);
    if (!group) return null;
    const members = portfolioRows.filter((row) => row.isin !== "" && group.isins.includes(row.isin));
    const known = members.filter((row) => row.value !== null);
    return known.length === 0 ? group : { ...group, ...figuresOf(known, null) };
  }, [groupData, portfolioRows]);
  const allGroups = useMemo(() => (defaultGroup ? [...groups, defaultGroup] : groups), [groups, defaultGroup]);
  const groupErrors = useMemo(
    () =>
      Object.entries(dashboard?.groups ?? {})
        .filter(([key]) => key.endsWith(":error"))
        .map(([, value]) => String(value)),
    [dashboard],
  );

  const overviewData = useMemo(() => summarizeOverview(dashboard?.portfolios ?? [], portfolioRows), [dashboard, portfolioRows]);

  const dataIssues = useMemo(() => dataIssueMessages(dashboard), [dashboard]);

  const todayReturn = overviewData.performance.get("Today") ?? null;

  const portfolioTotals = useMemo(
    () =>
      (dashboard?.portfolios ?? []).map((portfolio) => {
        const rows = portfolioRows.filter((row) => row.portfolioId === portfolio.portfolioId);
        const fromRows = rows.some((row) => row.value !== null) ? rows.reduce((total, row) => total + (row.value ?? 0), 0) : null;
        return overviewTotal(portfolio.overview) ?? fromRows;
      }),
    [dashboard, portfolioRows],
  );
  const hasPortfolioValue = portfolioTotals.some((total) => total !== null);
  const portfolioTotal = portfolioTotals.reduce<number>((total, item) => total + (item ?? 0), 0);
  const totalCurrency = portfolioRows[0]?.currency ?? "EUR";

  const diagnostics = useMemo(() => {
    if (!dashboard || !showDiagnostics) return "";
    return JSON.stringify(
      {
        portfolios: dashboard.portfolios,
        watchlist: dashboard.watchlist,
        quotes: dashboard.quotes ?? {},
        parsedRows: [...portfolioRows, ...watchlistRows].map(({ symbol, lastPrice: price, change, quantity, value, currency }) => ({ symbol, price, change, quantity, value, currency })),
        portfolioTotals,
        mcpTools: dashboard.tools ?? [],
        toolSchemas: dashboard.toolDefs ?? [],
        groupTools: dashboard.tools?.filter((tool) => /group/i.test(tool)) ?? [],
        groups: dashboard.groups ?? {},
        parsedGroups: groups.map(({ name, isins, portfolioIds }) => ({ name, isins: isins.length, portfolioIds })),
      },
      null,
      2,
    );
  }, [dashboard, showDiagnostics, portfolioRows, watchlistRows, portfolioTotals, groups]);

  return {
    portfolioRows,
    watchlistRows,
    groupData,
    groups,
    defaultGroup,
    allGroups,
    groupErrors,
    overviewData,
    dataIssues,
    todayReturn,
    hasPortfolioValue,
    portfolioTotal,
    totalCurrency,
    diagnostics,
  };
}
