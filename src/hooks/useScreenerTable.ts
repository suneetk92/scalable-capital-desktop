import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UNGROUPED_ID, type SecurityGroup } from "../groups";
import type { View } from "../nav";
import { columnById, marketSortValue, type MarketRecord } from "../marketColumns";
import { extension } from "../extensions";
import { groupHas, type ChangeFilter, type ScreenerRow, type SortKey } from "../screener";

type RowSortKey = "symbol" | "exchange" | "lastPrice" | "change" | "quantity" | "value" | "avgPrice" | "cost" | "sinceBuy" | "sinceBuyPct" | "weight" | "today" | "bid" | "ask" | "spreadPct";

/** Missing numbers sort as the smallest. */
function compareNumbers(a: number | null, b: number | null) {
  const left = a ?? Number.NEGATIVE_INFINITY;
  const right = b ?? Number.NEGATIVE_INFINITY;
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortValue(row: ScreenerRow, key: SortKey, records: Map<string, MarketRecord>) {
  const column = extension.tableColumns?.column(key) ?? columnById(key);
  if (column && column.source !== "scalable") {
    const record = records.get(row.isin.toUpperCase());
    return extension.tableColumns?.sortValue?.(column, record) ?? marketSortValue(column, record);
  }
  // The column id of the price is "price" (it is stored in the settings); the row field is `lastPrice`.
  return row[(key === "price" ? "lastPrice" : key) as RowSortKey];
}

/** Everything the Portfolio/Watchlist table remembers (search, filters, sort, selection, page) and the rows derived from it. */
export function useScreenerTable({
  view,
  portfolioRows,
  watchlistRows,
  groups,
  pageSize,
  columns,
  marketRecords,
}: {
  view: View;
  /** Column ids shown after the symbol; only these can be sorted by. */
  columns: readonly string[];
  marketRecords: Map<string, MarketRecord>;
  portfolioRows: ScreenerRow[];
  watchlistRows: ScreenerRow[];
  groups: SecurityGroup[];
  pageSize: number;
}) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const tableScroll = useRef<HTMLDivElement>(null);
  const [groupFilter, setGroupFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("symbol");
  const [sortDirection, setSortDirection] = useState<"ascending" | "descending">("ascending");
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>("all");
  const [heldOnly, setHeldOnly] = useState(false);
  const [groupRows, setGroupRows] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  const activeGroup = groups.find((group) => group.id === groupFilter) ?? null;
  // The default group holds every row that is in none of the real groups.
  const inRealGroup = useCallback((row: ScreenerRow) => groups.some((group) => !group.isDefault && groupHas(group, row)), [groups]);

  const activeSortKey: SortKey = sortKey === "symbol" || columns.includes(sortKey) ? sortKey : "symbol";

  const visibleRows = useMemo(() => {
    const rows = (view === "portfolio" ? portfolioRows : watchlistRows)
      .filter((row) => `${row.symbol} ${row.name} ${row.exchange}`.toLowerCase().includes(query.trim().toLowerCase()))
      .filter((row) => changeFilter === "all" || (row.change !== null && (changeFilter === "gainers" ? row.change > 0 : row.change < 0)))
      .filter((row) => view !== "watchlist" || !heldOnly || (row.quantity ?? 0) > 0 || (row.value ?? 0) > 0)
      .filter((row) => !activeGroup || (activeGroup.isDefault ? !inRealGroup(row) : groupHas(activeGroup, row)));
    rows.sort((left, right) => {
      const a = sortValue(left, activeSortKey, marketRecords);
      const b = sortValue(right, activeSortKey, marketRecords);
      const compared =
        typeof a === "string" || typeof b === "string" ? String(a ?? "").localeCompare(String(b ?? "")) : compareNumbers(typeof a === "number" ? a : null, typeof b === "number" ? b : null);
      return sortDirection === "ascending" ? compared : -compared;
    });
    return rows;
  }, [activeGroup, activeSortKey, changeFilter, heldOnly, inRealGroup, marketRecords, portfolioRows, query, sortDirection, view, watchlistRows]);

  const tableSections = useMemo(() => {
    if (view !== "portfolio" || !groupRows || !groups.some((group) => !group.isDefault)) return [];
    const taken = new Set<string>();
    const sections: { key: string; title: string; group: SecurityGroup | null; rows: ScreenerRow[] }[] = [];
    for (const group of groups) {
      const rows = visibleRows.filter((row) => !taken.has(row.rowId) && (group.isDefault ? !inRealGroup(row) : groupHas(group, row)));
      rows.forEach((row) => taken.add(row.rowId));
      if (rows.length > 0) sections.push({ key: group.id, title: group.name, group, rows });
    }
    const rest = visibleRows.filter((row) => !taken.has(row.rowId));
    if (rest.length > 0) sections.push({ key: UNGROUPED_ID, title: "Default", group: null, rows: rest });
    return sections;
  }, [groupRows, groups, inRealGroup, view, visibleRows]);

  // Rows in display order (grouped sections first), cut into pages.
  const orderedRows = useMemo(() => (tableSections.length > 0 ? tableSections.flatMap((section) => section.rows) : visibleRows), [tableSections, visibleRows]);
  const rowsPerPage = pageSize > 0 ? pageSize : Math.max(orderedRows.length, 1);
  const pageCount = Math.max(1, Math.ceil(orderedRows.length / rowsPerPage));
  const currentPage = Math.min(page, pageCount);
  const pagedRows = useMemo(() => orderedRows.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage), [currentPage, orderedRows, rowsPerPage]);

  const tableItems = useMemo(() => {
    if (tableSections.length === 0) return pagedRows.map((row) => ({ kind: "row" as const, row, sectionKey: undefined as string | undefined }));
    const onPage = new Set(pagedRows.map((row) => row.rowId));
    return tableSections.flatMap((section) => {
      const rows = section.rows.filter((row) => onPage.has(row.rowId));
      if (rows.length === 0) return [];
      return [{ kind: "header" as const, section }, ...(collapsedGroups.has(section.key) ? [] : rows.map((row) => ({ kind: "row" as const, row, sectionKey: section.key })))];
    });
  }, [collapsedGroups, pagedRows, tableSections]);

  const selectedRows = useMemo(() => visibleRows.filter((row) => selected.has(row.rowId)), [selected, visibleRows]);
  const pageSelected = pagedRows.length > 0 && pagedRows.every((row) => selected.has(row.rowId));
  const pageSomeSelected = pagedRows.some((row) => selected.has(row.rowId));

  useEffect(() => setPage(1), [view, query, changeFilter, heldOnly, groupFilter, groupRows, pageSize]);
  useEffect(() => setSelected(new Set()), [view]);

  const activeFilters = (changeFilter !== "all" ? 1 : 0) + (view === "watchlist" && heldOnly ? 1 : 0) + (activeGroup ? 1 : 0);

  function clearFilters() {
    setChangeFilter("all");
    setHeldOnly(false);
    setGroupFilter("all");
  }

  function toggleSection(key: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  function toggleRow(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function togglePage(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of pagedRows) {
        if (checked) next.add(row.rowId);
        else next.delete(row.rowId);
      }
      return next;
    });
  }

  function toggleSort(column: SortKey) {
    if (column === activeSortKey) setSortDirection((direction) => (direction === "ascending" ? "descending" : "ascending"));
    else {
      setSortKey(column);
      setSortDirection(column === "symbol" ? "ascending" : "descending");
    }
  }

  return {
    page,
    setPage,
    selected,
    setSelected,
    tableScroll,
    groupFilter,
    setGroupFilter,
    query,
    setQuery,
    sortKey,
    sortDirection,
    changeFilter,
    setChangeFilter,
    heldOnly,
    setHeldOnly,
    groupRows,
    setGroupRows,
    collapsedGroups,
    activeGroup,
    activeSortKey,
    visibleRows,
    tableSections,
    orderedRows,
    rowsPerPage,
    pageCount,
    currentPage,
    pagedRows,
    tableItems,
    selectedRows,
    pageSelected,
    pageSomeSelected,
    activeFilters,
    clearFilters,
    toggleSection,
    toggleRow,
    togglePage,
    toggleSort,
  };
}

export type ScreenerTableState = ReturnType<typeof useScreenerTable>;
