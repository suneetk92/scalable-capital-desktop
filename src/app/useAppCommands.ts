import { ACCESS_MODES } from "../access";
import type { AccessMode } from "../types";
import {
  ArrowPathIcon,
  ArrowRightStartOnRectangleIcon,
  ArrowTopRightOnSquareIcon,
  ClockIcon,
  Cog6ToothIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  StarIcon,
  TableCellsIcon,
} from "@heroicons/react/24/outline";
import { openUrl } from "@tauri-apps/plugin-opener";
import { clearHistories } from "../activityCache";
import { invokeCommand, TOOL } from "../commands";
import type { PaletteItem } from "../CommandPalette";
import type { MenuEntry } from "../controls";
import { pluralize } from "../format";
import { canMoveHolding, type SecurityGroup } from "../groups";
import { columnById, exportValue } from "../marketColumns";
import { NAV_ITEMS, type CoreView } from "../nav";
import { extension } from "../extensions";
import type { OrderPortfolio, OrderSide } from "../OrderDialog";
import { holdingsByIsin } from "../order";
import { buyingPower, csvCell, portfolioCurrency, type ScreenerRow } from "../screener";
import { clearToolQueryCache } from "../toolActions";
import type { AppData } from "./useAppData";
import { getErrorMessage, invoke } from "./invoke";

/** What the user can do from anywhere: refresh, copy, open an order or a security, bulk edits, sign in and out, and the palette and menu entries built from them. */
export function useAppCommands(data: AppData) {
  const {
    dashboard,
    setDashboard,
    setError,
    setView,
    setLoginPending,
    setConfirmingSignOut,
    setConfirmingTrading,
    setConfirmingStartupTrading,
    marketOpen,
    setAccessSwitch,
    access,
    setOrderTarget,
    setSecurityTarget,
    settings,
    updateSettings,
    loadDashboard,
    marketTableOpen,
    toolActions,
    table,
    tableColumns,
    market,
    portfolioRows,
    watchlistRows,
    watchedIsins,
    nav,
    searchInput,
    syncing,
    autoRefresh,
    extensionRuntime,
  } = data;

  function toggleAutoRefresh() {
    updateSettings({ autoRefresh: !settings.autoRefresh });
  }

  function refreshAccount() {
    void loadDashboard(false);
    if (marketTableOpen) extensionRuntime.refresh?.();
  }

  function openGroup(group: SecurityGroup) {
    table.setGroupFilter(group.id);
    setView("portfolio");
  }

  async function copyText(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      toolActions.notify({ kind: "ok", text: done });
      return true;
    } catch {
      toolActions.notify({ kind: "error", text: "Could not copy to the clipboard." });
      return false;
    }
  }

  async function copyToken() {
    try {
      const token = await invokeCommand(invoke, "get_access_token");
      await copyText(token, "Access token copied. Treat it like a password and sign out when done.");
    } catch (tokenError) {
      toolActions.notify({ kind: "error", text: getErrorMessage(tokenError) });
    }
  }

  async function copyCsv(rows: ScreenerRow[] = table.visibleRows) {
    const columns = tableColumns.flatMap((id) => {
      const column = extension.tableColumns?.column(id) ?? columnById(id);
      return column ? [column] : [];
    });
    const scalableValues: Record<string, (row: ScreenerRow) => string | number | null> = {
      price: (row) => row.lastPrice,
      bid: (row) => row.bid ?? null,
      ask: (row) => row.ask ?? null,
      spreadPct: (row) => row.spreadPct ?? null,
      change: (row) => row.change,
      quantity: (row) => row.quantity,
      value: (row) => row.value,
      exchange: (row) => row.exchange,
      avgPrice: (row) => row.avgPrice ?? null,
      cost: (row) => row.cost ?? null,
      sinceBuy: (row) => row.sinceBuy ?? null,
      sinceBuyPct: (row) => row.sinceBuyPct ?? null,
    };
    const header = ["Symbol", "Name", "ISIN", ...columns.map((column) => column.label), "Currency"];
    const lines = rows.map((row) =>
      [
        row.symbol,
        row.name,
        row.isin,
        ...columns.map((column) =>
          column.source === "scalable"
            ? (scalableValues[column.id]?.(row) ?? null)
            : (extension.tableColumns?.exportValue?.(column, market.records.get(row.isin.toUpperCase())) ?? exportValue(column, market.records.get(row.isin.toUpperCase()))),
        ),
        row.currency,
      ]
        .map(csvCell)
        .join(","),
    );
    await copyText([header.join(","), ...lines].join("\n"), `Copied ${pluralize(rows.length, "row")} as CSV.`);
  }

  // Lowering the access level needs no question; Full access asks first (and needs the exchange to be open), from every switch.
  function chooseAccess(mode: AccessMode) {
    if (mode === "full") {
      if (marketOpen && access !== "full") setConfirmingTrading(true);
    } else setAccessSwitch(mode);
  }

  // The account menu cycles Read-only, Restricted, Full (while the exchange is open).
  function cycleAccess() {
    chooseAccess(access === "readonly" ? "restricted" : access === "restricted" && marketOpen ? "full" : "readonly");
  }

  // The Settings choice is the only saved one; it applies from the next launch, and Full asks first.
  function chooseStartAccess(mode: AccessMode) {
    if (mode === "full" && settings.startAccess !== "full") setConfirmingStartupTrading(true);
    else updateSettings({ startAccess: mode });
  }

  function openOrder(side: OrderSide, row: ScreenerRow | null) {
    setOrderTarget({
      side,
      security: row && row.isin ? { isin: row.isin, name: row.name, symbol: row.symbol, currency: row.currency } : null,
      portfolioId: row?.portfolioId || dashboard?.portfolios[0]?.portfolioId || "",
      heldQuantity: row && row.portfolioId ? row.quantity : null,
      lastPrice: row?.lastPrice ?? null,
    });
  }

  const orderPortfolios: OrderPortfolio[] = (dashboard?.portfolios ?? []).map((portfolio) => ({
    portfolioId: portfolio.portfolioId,
    name: portfolio.name,
    buyingPower: buyingPower(portfolio.cash),
    currency: portfolioCurrency(portfolio.portfolio, portfolio.cash),
    holdings: holdingsByIsin(portfolioRows, portfolio.portfolioId),
  }));

  async function signIn() {
    setError(null);
    setLoginPending(true);
    try {
      const authorizationUrl = await invokeCommand(invoke, "begin_login");
      await openUrl(authorizationUrl);
    } catch (loginError) {
      setLoginPending(false);
      setError(getErrorMessage(loginError));
    }
  }

  async function signOut() {
    setConfirmingSignOut(false);
    try {
      await invokeCommand(invoke, "logout");
      // The backend switched Trading off with the sign-out; the UI follows so the next sign-in starts read-only.
      setAccessSwitch("readonly");
      clearHistories();
      clearToolQueryCache();
      setDashboard(null);
      setView("overview");
      setError(null);
    } catch (logoutError) {
      setError(getErrorMessage(logoutError));
    }
  }

  function openSecurity(row: ScreenerRow) {
    if (!row.isin) return;
    setSecurityTarget({
      isin: row.isin,
      name: row.name,
      symbol: row.symbol,
      currency: row.currency,
      lastPrice: row.lastPrice,
      change: row.change,
      portfolioId: row.portfolioId,
      quantity: row.quantity,
      inWatchlist: watchedIsins ? watchedIsins.has(row.isin) : null,
    });
  }

  function openFound(found: { isin: string; name: string }) {
    const held = portfolioRows.find((row) => row.isin === found.isin);
    const watched = watchlistRows.find((row) => row.isin === found.isin);
    const known = held ?? watched;
    setSecurityTarget({
      isin: found.isin,
      name: found.name,
      symbol: known?.symbol ?? found.name,
      currency: known?.currency ?? "EUR",
      lastPrice: known?.lastPrice ?? null,
      change: known?.change ?? null,
      portfolioId: held?.portfolioId ?? "",
      quantity: held?.quantity ?? null,
      inWatchlist: watchedIsins ? watchedIsins.has(found.isin) : null,
    });
  }

  function tradeFound(found: { isin: string; name: string }, side: OrderSide = "buy") {
    const held = portfolioRows.find((row) => row.isin === found.isin);
    const known = held ?? watchlistRows.find((row) => row.isin === found.isin);
    setSecurityTarget(null);
    setOrderTarget({
      side,
      security: { isin: found.isin, name: found.name, symbol: found.name, currency: known?.currency ?? "EUR" },
      portfolioId: held?.portfolioId ?? dashboard?.portfolios[0]?.portfolioId ?? "",
      heldQuantity: held?.quantity ?? null,
      lastPrice: known?.lastPrice ?? null,
    });
  }

  async function bulkAddToGroup(group: SecurityGroup) {
    const isins = table.selectedRows.filter((row) => row.isin && (group.portfolioId === "" || row.portfolioId === group.portfolioId)).map((row) => row.isin);
    if (isins.length === 0) {
      toolActions.notify({ kind: "info", text: `None of the selected holdings are in the portfolio of ${group.name}.` });
      return;
    }
    const outcome = await toolActions.run(TOOL.addPortfolioGroupHoldings, { portfolioId: group.portfolioId, groupId: group.id, isins }, { done: `${isins.length} added to ${group.name}` });
    if (outcome?.ok) table.setSelected(new Set());
  }

  /** Moves a holding between groups: added to `to`, then removed from `from`; `null` or the Default group means "in no group". */
  async function moveHolding(row: ScreenerRow, from: SecurityGroup | null, to: SecurityGroup | null) {
    if (!canMoveHolding(row, from, to, toolActions.has)) return;
    const source = from && !from.isDefault ? from : null;
    const target = to && !to.isDefault ? to : null;
    const done = source && target ? `${row.name} moved from ${source.name} to ${target.name}` : target ? `${row.name} added to ${target.name}` : `${row.name} removed from ${source?.name}`;
    if (target && !target.isins.includes(row.isin)) {
      // With a removal to follow, the data is updated once, after it.
      const added = await toolActions.run(
        TOOL.addPortfolioGroupHoldings,
        { portfolioId: target.portfolioId, groupId: target.id, isins: [row.isin] },
        source ? { done: false, refresh: false } : { done },
      );
      if (!added?.ok) return;
    }
    if (!source) return;
    const removed = await toolActions.run(TOOL.removePortfolioGroupHoldings, { portfolioId: source.portfolioId, groupId: source.id, isins: [row.isin] }, { done });
    // The holding was added to the target but is still in its old group: show that as it is.
    if (!removed?.ok && target) void loadDashboard(false);
  }

  async function bulkWatchlist(add: boolean) {
    if (!watchedIsins) {
      toolActions.notify({ kind: "error", text: "Your watchlist could not be loaded, so nothing was changed. Refresh and try again." });
      return;
    }
    const targets = table.selectedRows.filter((row) => row.isin && (add ? !watchedIsins.has(row.isin) : true));
    if (targets.length === 0) {
      toolActions.notify({ kind: "info", text: add ? "The selected securities are already on your watchlist." : "Nothing selected to remove." });
      return;
    }
    const tool = add ? TOOL.addWatchlistItem : TOOL.removeWatchlistItem;
    for (const [index, row] of targets.entries()) {
      const last = index === targets.length - 1;
      const outcome = await toolActions.run(
        tool,
        { isin: row.isin },
        {
          confirm: !add && index === 0 ? `Remove ${pluralize(targets.length, "security", "securities")} from your watchlist?` : undefined,
          confirmLabel: "Remove",
          refresh: !add || last,
          done: last ? `${pluralize(targets.length, "security", "securities")} ${add ? "added to" : "removed from"} your watchlist` : `${row.name} ${add ? "added" : "removed"}`,
        },
      );
      if (!outcome?.ok) return;
    }
    table.setSelected(new Set());
  }

  function paletteItems(): PaletteItem[] {
    const pages = nav.navOrder.flatMap((id): PaletteItem[] => {
      const item = NAV_ITEMS[id as CoreView] ?? extension.views?.find((view) => view.id === id);
      return item ? [{ id: `page-${id}`, group: "Pages", label: `Go to ${item.label}`, icon: item.icon, run: () => setView(id) }] : [];
    });
    const actions: PaletteItem[] = [
      { id: "act-refresh", group: "Actions", label: "Refresh data", icon: ArrowPathIcon, run: refreshAccount },
      { id: "act-auto", group: "Actions", label: autoRefresh ? "Turn Scalable auto-refresh off" : "Turn Scalable auto-refresh on", icon: ClockIcon, run: toggleAutoRefresh },
      ...ACCESS_MODES.filter((item) => item.mode !== access && (item.mode !== "full" || marketOpen)).map((item) => ({
        id: `act-access-${item.mode}`,
        group: "Actions",
        label: item.command,
        icon: ShieldCheckIcon,
        run: () => chooseAccess(item.mode),
      })),
      {
        id: "act-search",
        group: "Actions",
        label: "Search the table",
        hint: "Ctrl+K",
        icon: MagnifyingGlassIcon,
        run: () =>
          window.setTimeout(() => {
            searchInput.current?.focus();
            searchInput.current?.select();
          }, 0),
      },
      { id: "act-signout", group: "Actions", label: "Sign out", icon: ArrowRightStartOnRectangleIcon, run: () => setConfirmingSignOut(true) },
    ];
    const securities = (rows: ScreenerRow[], group: string, icon: typeof StarIcon): PaletteItem[] =>
      rows.filter((row) => row.isin).map((row) => ({ id: `${group}-${row.rowId}`, group, label: row.name, hint: row.symbol, icon, searchOnly: true, run: () => openSecurity(row) }));
    return [...pages, ...actions, ...securities(portfolioRows, "Holdings", TableCellsIcon), ...securities(watchlistRows, "Watchlist", StarIcon), ...(extension.palette?.({ data, commands }) ?? [])];
  }

  const accountItems: (MenuEntry | "divider")[] = [
    { id: "refresh", label: "Refresh data", icon: ArrowPathIcon, disabled: syncing, onSelect: refreshAccount },
    { id: "auto", label: "Scalable auto-refresh", icon: ClockIcon, hint: autoRefresh ? "On" : "Off", onSelect: toggleAutoRefresh },
    { id: "trading", label: "Access", icon: ShieldCheckIcon, hint: ACCESS_MODES.find((item) => item.mode === access)?.label, onSelect: cycleAccess },
    { id: "settings", label: "Settings", icon: Cog6ToothIcon, onSelect: () => setView("settings") },
    {
      id: "scalable",
      label: "Open Scalable Capital",
      icon: ArrowTopRightOnSquareIcon,
      onSelect: () => void openUrl("https://scalable.capital").catch((openError) => setError(getErrorMessage(openError))),
    },
    "divider",
    { id: "signout", label: "Sign out", icon: ArrowRightStartOnRectangleIcon, danger: true, onSelect: () => setConfirmingSignOut(true) },
  ];

  const commands = {
    toggleAutoRefresh,
    refreshAccount,
    openGroup,
    copyText,
    copyToken,
    copyCsv,
    chooseAccess,
    chooseStartAccess,
    cycleAccess,
    openOrder,
    orderPortfolios,
    signIn,
    signOut,
    openSecurity,
    openFound,
    tradeFound,
    bulkAddToGroup,
    moveHolding,
    bulkWatchlist,
    paletteItems,
    get accountItems() {
      return [...accountItems, ...(extension.accountMenu?.({ data, commands }) ?? [])];
    },
  };
  return commands;
}

export type AppCommands = ReturnType<typeof useAppCommands>;
