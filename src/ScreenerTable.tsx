import { Bars2Icon, ChevronDownIcon, MagnifyingGlassIcon, RectangleGroupIcon, StarIcon, TableCellsIcon } from "@heroicons/react/24/outline";
import { useCallback, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ColumnHead, resizedTable } from "./ColumnHead";
import { ColumnPicker } from "./ColumnPicker";
import { moveColumn, useColumnWidths, type ColumnLayout } from "./hooks/useTableLayout";
import { CheckboxField, DropdownMenu, EmptyState, FILTER_TITLE, FiltersPopover, Pagination, RadioList, RowCheckbox, SearchBox, SortButton, type MenuEntry } from "./controls";
import { ScreenerRowView } from "./ScreenerRow";
import type { ScreenerTableState } from "./hooks/useScreenerTable";
import type { View } from "./nav";
import { columnById, DEFAULT_COLUMNS, type MarketRecord } from "./marketColumns";
import { extension } from "./extensions";
import { formatChange, formatMoney, type ChangeFilter, type ScreenerRow } from "./screener";
import type { ToolActions } from "./toolActions";
import { btn, cx, field, NAME_COLUMN, PANEL, PanelFooter, PanelHeader, SignGlyph, signClass, TABLE, TH_NUM } from "./ui";
import { canMoveHolding, UNGROUPED_ID, type SecurityGroup } from "./groups";
import { formatDate, pluralize } from "./format";
import { TOOL } from "./commands";
import { SecuritySearchResults } from "./SecuritySearch";
import type { Invoke } from "./tools";
import { useRowWindow } from "./hooks/useRowWindow";
import { useSectionDrag, type SectionDrag } from "./hooks/useSectionDrag";

export function ScreenerTable({
  view,
  table,
  columns,
  extensionEnabled,
  marketRecords,
  logos,
  isinLogos,
  extensionLoading,
  extensionError,
  extensionCurrency,
  groups,
  watchlistUnknown,
  tradingEnabled,
  toolActions,
  lastUpdated,
  showDiagnostics,
  searchInput,
  invoke,
  watchedIsins,
  heldIsins,
  onSelectView,
  onOpenDiscover,
  onChangeColumns,
  onCopyCsv,
  onBulkAddToGroup,
  onBulkWatchlist,
  onOpenSecurity,
  onOpenFound,
  onOpenOrder,
  onRefresh,
  onMoveGroup,
  onMoveHolding,
}: {
  view: "portfolio" | "watchlist";
  table: ScreenerTableState;
  /** Column ids chosen with the + button, after the symbol. */
  columns: readonly string[];
  /** Whether the configured extension columns are visible. */
  extensionEnabled: boolean;
  marketRecords: Map<string, MarketRecord>;
  /** Optional extension-provided logos. */
  logos: ReadonlyMap<string, string>;
  /** Optional extension-provided logos by ISIN. */
  isinLogos: ReadonlyMap<string, string>;
  extensionLoading: boolean;
  extensionError: string | null;
  extensionCurrency: string;
  onChangeColumns: (columns: string[]) => void;
  groups: SecurityGroup[];
  watchlistUnknown: boolean;
  tradingEnabled: boolean;
  toolActions: ToolActions;
  lastUpdated: Date | null;
  showDiagnostics: boolean;
  searchInput: RefObject<HTMLInputElement | null>;
  invoke: Invoke;
  /** ISINs on the watchlist, or null when it could not be loaded. */
  watchedIsins: ReadonlySet<string> | null;
  heldIsins: ReadonlySet<string>;
  onSelectView: (view: View) => void;
  onOpenDiscover: (query: string) => void;
  onCopyCsv: (rows?: ScreenerRow[]) => Promise<void>;
  onBulkAddToGroup: (group: SecurityGroup) => Promise<void>;
  onBulkWatchlist: (add: boolean) => Promise<void>;
  onOpenSecurity: (row: ScreenerRow) => void;
  /** Opens a security found by the search box that is not in the table. */
  onOpenFound: (security: { isin: string; name: string }) => void;
  onOpenOrder: (side: "buy" | "sell", row: ScreenerRow | null) => void;
  onRefresh: () => void;
  /** Puts group `from` in the place of group `to` (the order is kept on this computer). */
  onMoveGroup: (from: string, to: string) => void;
  /** Moves a holding between groups; `null` stands for the Default section. */
  onMoveHolding: (row: ScreenerRow, from: SecurityGroup | null, to: SecurityGroup | null) => Promise<void>;
}) {
  const {
    activeFilters,
    activeGroup,
    activeSortKey,
    changeFilter,
    setChangeFilter,
    groupRows,
    setGroupRows,
    heldOnly,
    setHeldOnly,
    setGroupFilter,
    query,
    setQuery,
    clearFilters,
    visibleRows,
    selectedRows,
    selected,
    setSelected,
    tableScroll,
    pageSelected,
    pageSomeSelected,
    togglePage,
    toggleSort,
    sortDirection,
    tableItems,
    tableSections,
    collapsedGroups,
    toggleSection,
    toggleRow,
    currentPage,
    pageCount,
    orderedRows,
    rowsPerPage,
    setPage,
    setSectionPage,
  } = table;
  const rowKeys = tableItems.map((item) => (item.kind === "header" ? `group:${item.section.key}` : item.kind === "pager" ? `pager:${item.section.key}` : `row:${item.row.rowId}`));
  const { bodyRef, window: rowWindow } = useRowWindow(rowKeys, tableScroll);
  // The search text whose security results were closed (Escape, a click elsewhere or a pick); typing more shows them again.
  const [dismissed, setDismissed] = useState("");
  const latestHandlers = useRef({
    toggleRow,
    onOpenSecurity,
    onOpenOrder,
    toolActions,
  });
  latestHandlers.current = {
    toggleRow,
    onOpenSecurity,
    onOpenOrder,
    toolActions,
  };
  const handleToggleRow = useCallback((rowId: string, checked: boolean) => latestHandlers.current.toggleRow(rowId, checked), []);
  const handleOpenSecurity = useCallback((row: ScreenerRow) => latestHandlers.current.onOpenSecurity(row), []);
  const handleOpenOrder = useCallback((side: "buy" | "sell", row: ScreenerRow) => latestHandlers.current.onOpenOrder(side, row), []);
  const handleRemove = useCallback((row: ScreenerRow) => {
    void latestHandlers.current.toolActions.run(
      TOOL.removeWatchlistItem,
      { isin: row.isin },
      {
        confirm: `Remove ${row.name} from your watchlist?`,
        confirmLabel: "Remove",
        done: `${row.name} removed from your watchlist`,
      },
    );
  }, []);
  // The column only appears when a button would be in it; read-only mode hides the buy, sell and remove buttons.
  const hasRowActions = tradingEnabled || (view === "watchlist" && toolActions.has(TOOL.removeWatchlistItem));
  const columnOf = useCallback((id: string) => extension.tableColumns?.column(id) ?? columnById(id), []);
  const shownColumns = useMemo(
    () =>
      columns.flatMap((id) => {
        const column = columnOf(id);
        return column && (extensionEnabled || column.source === "scalable") ? [column] : [];
      }),
    [columnOf, columns, extensionEnabled],
  );
  const usesExtensionData = shownColumns.some((column) => column.source !== "scalable");
  const [widths, setWidths] = useColumnWidths(`screener-${view}`);
  const columnLayout: ColumnLayout = {
    widths,
    setWidths,
    move: (from, to, after) => {
      if (from === "symbol") return;
      const ids = shownColumns.map((column) => column.id);
      onChangeColumns(to === "symbol" ? (after ? moveColumn(ids, from, ids[0] ?? from, false) : ids) : moveColumn(ids, from, to, after));
    },
  };
  // Buy and Remove sit side by side on the watchlist, which needs more room than Buy and Sell.
  const actionsWidth = view === "watchlist" && tradingEnabled && toolActions.has(TOOL.removeWatchlistItem) ? 11.5 : 8.6667;
  const resized = resizedTable(widths, 5.75 + (hasRowActions ? actionsWidth : 0));
  const columnCount = 3 + shownColumns.length + (hasRowActions ? 1 : 0);
  const filtered = query !== "" || activeFilters > 0;

  // Drag and drop in the table divided into groups: a group header reorders the groups, a holding row moves to another group.
  const groupKeys = tableSections.flatMap((section) => (section.group && !section.group.isDefault ? [section.key] : []));
  const canReorder = groupKeys.length > 1;
  const canMoveRows = view === "portfolio" && (toolActions.has(TOOL.addPortfolioGroupHoldings) || toolActions.has(TOOL.removePortfolioGroupHoldings));
  const sectionGroup = (key: string) => (key === UNGROUPED_ID ? null : (tableSections.find((section) => section.key === key)?.group ?? null));
  const sectionTitle = (key: string) => tableSections.find((section) => section.key === key)?.title ?? "";
  const { drag, dropKey, pointer, startDrag } = useSectionDrag<ScreenerRow>({
    container: tableScroll,
    canDrop: (item, key) => key !== item.key && (item.kind === "section" ? groupKeys.includes(key) : canMoveHolding(item.row, sectionGroup(item.key), sectionGroup(key), toolActions.has)),
    onDrop: (item, key) => {
      if (item.kind === "section") onMoveGroup(item.key, key);
      else void onMoveHolding(item.row, sectionGroup(item.key), sectionGroup(key));
    },
  });
  const draggedRowId = drag?.kind === "row" ? drag.row.rowId : null;

  function handleBodyPointerDown(event: ReactPointerEvent<HTMLTableSectionElement>) {
    if (tableSections.length === 0 || event.pointerType === "touch") return;
    const element = event.target as HTMLElement;
    const item = tableItems[Number(element.closest<HTMLElement>("tr[data-index]")?.dataset.index ?? -1)];
    if (!item || item.kind === "pager") return;
    if (item.kind === "header") {
      if (canReorder && groupKeys.includes(item.section.key))
        startDrag(event, {
          kind: "section",
          key: item.section.key,
          label: item.section.title,
        });
      return;
    }
    // The row's own buttons and checkbox keep working; a drag starts anywhere else in the row.
    if (!canMoveRows || !item.sectionKey || !item.row.isin || element.closest("button, input, a, label, [role=checkbox]")) return;
    startDrag(event, {
      kind: "row",
      key: item.sectionKey,
      row: item.row,
      label: item.row.name,
    });
  }

  function handleHeaderKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, key: string) {
    if (!canReorder || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    const index = groupKeys.indexOf(key);
    const neighbour = index < 0 ? undefined : groupKeys[index + (event.key === "ArrowUp" ? -1 : 1)];
    event.preventDefault();
    if (!neighbour) return;
    onMoveGroup(key, neighbour);
    const button = event.currentTarget;
    window.requestAnimationFrame(() => button.focus());
  }

  function dragText(item: SectionDrag<ScreenerRow>) {
    if (dropKey === null) return item.label;
    if (item.kind === "section") return `${item.label} \u2192 place of ${sectionTitle(dropKey)}`;
    return dropKey === UNGROUPED_ID ? `${item.label} \u2192 out of ${sectionTitle(item.key)}` : `${item.label} \u2192 ${sectionTitle(dropKey)}`;
  }

  return (
    <section className={PANEL} aria-label="Market screener">
      <div className="flex min-h-[3.6667rem] items-center justify-end gap-3.5 border-b border-line px-4 max-[900px]:flex-col max-[900px]:items-start">
        <div className="flex items-center gap-2 max-[900px]:w-full max-[900px]:pb-2.5">
          <div
            className="relative max-[900px]:flex-1"
            onKeyDown={(event) => event.key === "Escape" && setDismissed(query)}
            onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && setDismissed(query)}
          >
            <SearchBox inputRef={searchInput} value={query} onChange={setQuery} placeholder="Search symbol or name" label="Search holdings and watchlist" shortcut />
            {dismissed !== query && (
              <SecuritySearchResults
                text={query}
                invoke={invoke}
                enabled={toolActions.has("search_securities")}
                watched={watchedIsins}
                held={heldIsins}
                onOpen={(hit) => {
                  setDismissed(query);
                  onOpenFound(hit);
                }}
                onSeeAll={() => {
                  setDismissed(query);
                  onOpenDiscover(query.trim());
                }}
                onAddToWatchlist={
                  toolActions.has(TOOL.addWatchlistItem) ? (hit) => void toolActions.run(TOOL.addWatchlistItem, { isin: hit.isin }, { done: `${hit.name} added to your watchlist` }) : undefined
                }
              />
            )}
          </div>
          <FiltersPopover count={activeFilters} onClear={clearFilters}>
            <div className={FILTER_TITLE}>Day change</div>
            <RadioList<ChangeFilter>
              label="Day change"
              value={changeFilter}
              onChange={setChangeFilter}
              options={[
                ["all", "All"],
                ["gainers", "Gainers only"],
                ["losers", "Losers only"],
              ]}
            />
            {groups.length > 0 && (
              <>
                <div className={FILTER_TITLE}>Group</div>
                <RadioList label="Group" value={activeGroup?.id ?? "all"} onChange={setGroupFilter} options={[["all", "All"], ...groups.map((group): [string, string] => [group.id, group.name])]} />
              </>
            )}
            {view === "portfolio" && groups.some((group) => !group.isDefault) && (
              <>
                <div className={FILTER_TITLE}>Table</div>
                <CheckboxField checked={groupRows} onChange={setGroupRows}>
                  Divide rows into groups
                </CheckboxField>
              </>
            )}
            {view === "watchlist" && (
              <>
                <div className={FILTER_TITLE}>Watchlist</div>
                <CheckboxField checked={heldOnly} onChange={setHeldOnly}>
                  Also held in portfolio
                </CheckboxField>
              </>
            )}
          </FiltersPopover>
          <button className={btn.secondary} type="button" onClick={() => void onCopyCsv()} disabled={visibleRows.length === 0} title="Copy the rows shown as CSV">
            Copy CSV
          </button>
        </div>
      </div>
      <PanelHeader title={view === "portfolio" ? "Portfolio holdings" : "Saved watchlist"}>
        {pluralize(visibleRows.length, "result")}
        {lastUpdated ? ` \u00b7 Updated ${formatDate(lastUpdated, { hour: "2-digit", minute: "2-digit" })}` : ""}
        {usesExtensionData && extensionLoading ? " \u00b7 Loading additional data…" : ""}
      </PanelHeader>
      {usesExtensionData && extensionError && (
        <div className={`${field.note} mx-5 mb-3`} role="note">
          Additional columns could not be loaded: {extensionError}
        </div>
      )}
      {visibleRows.length > 0 &&
        (() => {
          const missing = [
            columns.includes("price") && visibleRows.every((row) => row.lastPrice === null) && "price",
            columns.includes("change") && visibleRows.every((row) => row.change === null) && "change %",
            view === "portfolio" && columns.includes("quantity") && visibleRows.every((row) => row.quantity === null) && "quantity",
            view === "portfolio" && columns.includes("value") && visibleRows.every((row) => row.value === null) && "value",
          ].filter(Boolean);
          return missing.length > 0 ? (
            <div className={`${field.note} mx-5 mb-3`} role="note">
              Could not read {missing.join(", ")} from Scalable's response.{" "}
              {showDiagnostics
                ? "Open Settings → Data and refresh → Raw data and copy the details so the field names can be matched."
                : "Turn on “Data diagnostics” in Settings → Data and refresh to copy the details so the field names can be matched."}{" "}
              Fields received: {visibleRows[0].keys.slice(0, 30).join(", ") || "none"}
            </div>
          ) : null;
        })()}
      {selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5 border-b border-accent-line bg-accent-bg px-4 py-2" role="region" aria-label="Selection actions">
          <strong className="font-semibold text-ink-heading">{selectedRows.length} selected</strong>
          {view === "portfolio" && groups.some((group) => !group.isDefault) && toolActions.has(TOOL.addPortfolioGroupHoldings) && (
            <DropdownMenu
              anchor={{ to: "bottom start", gap: 6, padding: 8 }}
              panelClassName="w-56"
              buttonClassName={btn.secondary}
              button={
                <>
                  Add to group <ChevronDownIcon aria-hidden="true" />
                </>
              }
              items={groups
                .filter((group) => !group.isDefault)
                .map((group): MenuEntry => ({
                  id: group.id,
                  label: group.name,
                  icon: RectangleGroupIcon,
                  onSelect: () => void onBulkAddToGroup(group),
                }))}
            />
          )}
          {view === "portfolio" && !watchlistUnknown && toolActions.has(TOOL.addWatchlistItem) && (
            <button className={btn.secondary} type="button" onClick={() => void onBulkWatchlist(true)}>
              Add to watchlist
            </button>
          )}
          {view === "watchlist" && toolActions.has(TOOL.removeWatchlistItem) && (
            <button className={btn.secondary} type="button" onClick={() => void onBulkWatchlist(false)}>
              Remove from watchlist
            </button>
          )}
          <button className={btn.secondary} type="button" onClick={() => void onCopyCsv(selectedRows)}>
            Copy CSV
          </button>
          <button className={btn.link} type="button" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}
      <div ref={tableScroll} className="max-h-[calc(100vh-12.6667rem)] min-h-40 overflow-auto">
        <table
          aria-rowcount={tableItems.length + 1 + (visibleRows.length === 0 ? 1 : 0)}
          className={cx(TABLE, "[&_thead]:bg-surface/80 [&_thead]:backdrop-blur-sm", resized.className)}
          style={resized.style}
        >
          <thead>
            <tr aria-rowindex={1}>
              <th scope="col" className="w-11 px-3!">
                <RowCheckbox label="Select all rows on this page" checked={pageSelected} indeterminate={!pageSelected && pageSomeSelected} onChange={togglePage} />
              </th>
              <ColumnHead id="symbol" label="Symbol / Name" layout={columnLayout} className={NAME_COLUMN} sortState={activeSortKey === "symbol" ? sortDirection : "none"}>
                <SortButton label="Symbol / Name" column="symbol" active={activeSortKey === "symbol"} direction={sortDirection} onSort={toggleSort} />
              </ColumnHead>
              {shownColumns.map((column) => (
                <ColumnHead key={column.id} id={column.id} label={column.label} layout={columnLayout} className={TH_NUM} sortState={activeSortKey === column.id ? sortDirection : "none"}>
                  <SortButton label={column.label} title={column.hint} column={column.id} active={activeSortKey === column.id} direction={sortDirection} onSort={toggleSort} />
                </ColumnHead>
              ))}
              {hasRowActions && (
                <th scope="col" className="text-right" style={{ width: `${actionsWidth}rem`, minWidth: `${actionsWidth}rem` }}>
                  {tradingEnabled ? "Trade" : "Actions"}
                </th>
              )}
              <th scope="col" className="w-12 text-right">
                <ColumnPicker columns={columns} extensionsEnabled={extensionEnabled} defaults={[...DEFAULT_COLUMNS, ...(extension.tableColumns?.defaults ?? [])]} onChange={onChangeColumns} />
              </th>
            </tr>
          </thead>
          <tbody ref={bodyRef} onPointerDown={handleBodyPointerDown}>
            {rowWindow.top > 0 && (
              <tr aria-hidden="true">
                <td className="border-0! p-0!" colSpan={columnCount} style={{ height: rowWindow.top }} />
              </tr>
            )}
            {tableItems.slice(rowWindow.start, rowWindow.end).map((item, visibleIndex) => {
              const index = rowWindow.start + visibleIndex;
              if (item.kind === "header") {
                const { section } = item;
                const total = section.rows.some((row) => row.value !== null) ? section.rows.reduce((sum, row) => sum + (row.value ?? 0), 0) : null;
                const sinceBuy = section.group?.sinceBuyPerformance ?? null;
                const collapsed = collapsedGroups.has(section.key);
                const reorderable = canReorder && groupKeys.includes(section.key);
                return (
                  <tr
                    key={`group-${section.key}`}
                    className={cx(dropKey === section.key ? "bg-accent-bg!" : "bg-raised!", drag?.kind === "section" && drag.key === section.key && "opacity-50")}
                    data-index={index}
                    data-section={section.key}
                    aria-rowindex={index + 2}
                  >
                    <td className="h-[2.5333rem]! border-line-strong! p-0!" colSpan={columnCount}>
                      <button
                        className="group/header flex min-h-[2.5333rem] w-full cursor-pointer items-center gap-3 px-4 text-left text-ink-strong"
                        type="button"
                        aria-expanded={!collapsed}
                        aria-keyshortcuts={reorderable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
                        title={reorderable ? "Drag to reorder the groups, or use Alt+Up and Alt+Down" : undefined}
                        onClick={() => toggleSection(section.key)}
                        onKeyDown={(event) => handleHeaderKeyDown(event, section.key)}
                      >
                        {reorderable && <Bars2Icon className="-mx-1 size-4 shrink-0 cursor-grab text-ink-faint group-hover/header:text-ink-muted" aria-hidden="true" />}
                        <ChevronDownIcon className={cx("size-4 shrink-0 text-ink-muted transition-transform", collapsed && "-rotate-90")} aria-hidden="true" />
                        <strong className="font-title">{section.title}</strong>
                        <span className="tabular-nums text-ink-muted">{pluralize(section.rows.length, "holding")}</span>
                        {total !== null && <span className="tabular-nums text-ink-muted">{formatMoney(total, section.rows[0]?.currency || "EUR")}</span>}
                        {sinceBuy !== null && (
                          <span className={cx("tabular-nums", signClass(sinceBuy))}>
                            <SignGlyph value={sinceBuy} />
                            {formatChange(sinceBuy * 100)} since buy
                          </span>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              }
              if (item.kind === "pager") {
                return (
                  <tr key={`pager-${item.section.key}`} className="bg-surface!" data-index={index} aria-rowindex={index + 2}>
                    <td className="h-auto! p-0!" colSpan={columnCount}>
                      <Pagination page={item.page} pageCount={item.pageCount} total={item.section.rows.length} pageSize={item.size} onPage={(next) => setSectionPage(item.section.key, next)} />
                    </td>
                  </tr>
                );
              }
              return (
                <ScreenerRowView
                  key={item.row.rowId}
                  row={item.row}
                  shownColumns={shownColumns}
                  marketRecord={marketRecords.get(item.row.isin.toUpperCase())}
                  marketCurrency={extensionCurrency}
                  formatExtensionCell={extension.tableColumns?.formatCell}
                  logos={logos}
                  isinLogos={isinLogos}
                  selected={selected.has(item.row.rowId)}
                  view={view}
                  tradingEnabled={tradingEnabled}
                  canRemove={toolActions.has(TOOL.removeWatchlistItem)}
                  hasRowActions={hasRowActions}
                  onToggleRow={handleToggleRow}
                  onOpenSecurity={handleOpenSecurity}
                  onOpenOrder={handleOpenOrder}
                  onRemove={handleRemove}
                  index={index}
                  sectionKey={item.sectionKey}
                  movable={canMoveRows && item.sectionKey !== undefined && item.row.isin !== ""}
                  dropTarget={item.sectionKey !== undefined && dropKey === item.sectionKey}
                  dragging={draggedRowId === item.row.rowId}
                />
              );
            })}
            {rowWindow.bottom > 0 && (
              <tr aria-hidden="true">
                <td className="border-0! p-0!" colSpan={columnCount} style={{ height: rowWindow.bottom }} />
              </tr>
            )}
            {visibleRows.length === 0 && (
              <tr aria-rowindex={2}>
                <td className="h-auto!" colSpan={columnCount}>
                  <EmptyState
                    icon={filtered ? MagnifyingGlassIcon : view === "portfolio" ? TableCellsIcon : StarIcon}
                    title={filtered ? "No matching securities" : view === "portfolio" ? "No holdings to show" : watchlistUnknown ? "Could not load your watchlist" : "Your watchlist is empty"}
                    text={
                      filtered
                        ? "Try another search or clear the filters."
                        : view === "portfolio"
                          ? "When Scalable returns holdings for your portfolio, they appear here."
                          : watchlistUnknown
                            ? "Scalable did not return your watchlist, so it may not be empty. Try Refresh."
                            : "Add securities from Discover or a security’s details to follow them here."
                    }
                    action={
                      filtered ? (
                        <button
                          className={btn.secondary}
                          type="button"
                          onClick={() => {
                            setQuery("");
                            clearFilters();
                          }}
                        >
                          Clear search and filters
                        </button>
                      ) : view === "watchlist" && !watchlistUnknown ? (
                        <button className={btn.primary} type="button" onClick={() => onSelectView("discover")}>
                          Go to Discover
                        </button>
                      ) : (
                        <button className={btn.secondary} type="button" onClick={() => onRefresh()}>
                          Refresh data
                        </button>
                      )
                    }
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        page={currentPage}
        pageCount={pageCount}
        total={orderedRows.length}
        pageSize={rowsPerPage}
        onPage={(next) => {
          setPage(next);
          tableScroll.current?.scrollTo({ top: 0 });
        }}
      />
      <PanelFooter tradingEnabled={tradingEnabled} />
      {drag &&
        pointer &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[80] max-w-80 truncate rounded-control border border-accent-line bg-surface px-2.5 py-1 font-label text-ink-strong shadow-[0_14px_40px_var(--pop-shadow)]"
            style={{ left: pointer.x + 14, top: pointer.y + 14 }}
            aria-hidden="true"
          >
            {dragText(drag)}
          </div>,
          document.body,
        )}
    </section>
  );
}
