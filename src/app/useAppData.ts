import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invokeCommand, TOOL } from "../commands";
import { useAlertWatch } from "../hooks/useAlertWatch";
import { useBackground } from "../hooks/useBackground";
import { useDashboardData } from "../hooks/useDashboardData";
import { useGroupFigures } from "../hooks/useGroupFigures";
import { useGroupOrder } from "../hooks/useGroupOrder";
import { useNavOrder } from "../hooks/useNavOrder";
import { useProviderStatus } from "../hooks/useProviderStatus";
import { useScreenerTable } from "../hooks/useScreenerTable";
import { useSessionInfo } from "../hooks/useSessionInfo";
import { markCancelled, useTransactionHistory } from "../hooks/useTransactionHistory";
import { useUpdater } from "../hooks/useUpdater";
import { keepLastGoodParts } from "../lastGood";
import { dashboardEffect, withoutWatchlistItem } from "../localChanges";
import { extension, type ExtensionData, type ExtensionRuntime } from "../extensions";
import type { MarketRecord } from "../marketColumns";
import type { View } from "../nav";
import type { OrderTarget } from "../OrderDialog";
import { collect, perPortfolio } from "../pages/shared";
import { pagePortfolios } from "../portfolios";
import type { Provider } from "../providerStatus";
import { profileName } from "../profile";
import { connectionCheckDue, nextRefreshDelay, wokeFromSleep } from "../refreshSchedule";
import type { DrawerTarget } from "../SecurityDrawer";
import { REFRESH_OPTIONS, useLightTheme, useSettings } from "../settings";
import { useToolActions, useToolQuery } from "../toolActions";
import { callTools, type ToolDef } from "../tools";
import { pickString, type Rec } from "../response";
import { dedupeRows } from "../transactions";
import type { Common, Connection, Dashboard } from "../types";
import { getErrorMessage, hasTauriRuntime, invoke } from "./invoke";

const CONNECTION_CHECK_MS = 60_000;
const WAKE_CHECK_MS = 30_000;
const EMPTY_DEFS: ToolDef[] = [];

const intervalLabel = (seconds: number) => (REFRESH_OPTIONS.find(([value]) => value === seconds)?.[1] ?? `${seconds} seconds`).replace(/^1 /, "");

/** The state of the app: the dashboard and its timers, the sign-in, the pages' data hooks and the open dialogs. */
export function useAppData() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>({ state: "checking" });
  const [view, setView] = useState<View>("overview");
  // The Transactions page keeps its filters and page number while another page is open, so it
  // stays mounted (hidden) once it has been opened.
  const [transactionsOpened, setTransactionsOpened] = useState(false);
  if (view === "transactions" && !transactionsOpened) setTransactionsOpened(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  // Never saved: every launch starts read-only, as the backend does.
  const [tradingEnabled, setTradingEnabled] = useState(false);
  const [confirmingTrading, setConfirmingTrading] = useState(false);
  const [orderTarget, setOrderTarget] = useState<OrderTarget | null>(null);
  const nav = useNavOrder();
  const { groupOrder, moveGroup: moveGroupIn } = useGroupOrder();
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const { settings, update: updateSettings, reset: resetSettings } = useSettings();
  const lightTheme = useLightTheme(settings.theme);
  const session = useSessionInfo(dashboard !== null, lastUpdated?.getTime() ?? 0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const autoRefresh = settings.autoRefresh;
  const refreshMs = settings.refreshSeconds * 1000;
  const refreshLabel = intervalLabel(settings.refreshSeconds);
  const [securityTarget, setSecurityTarget] = useState<DrawerTarget | null>(null);
  // The security details belong to the page they were opened on: switching pages closes them.
  const [targetView, setTargetView] = useState(view);
  if (targetView !== view) {
    setTargetView(view);
    setSecurityTarget(null);
  }
  const initialized = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const syncingRef = useRef(false);
  // Reloads that failed in a row: the automatic reload backs off while Scalable is down. The last successful
  // load time lets the connection check skip a `ping` that the load itself just answered.
  const failedReloadsRef = useRef(0);
  const lastLoadedAtRef = useRef<number | null>(null);
  const dashboardRef = useRef(dashboard);
  dashboardRef.current = dashboard;
  const { statuses: providerStatuses, succeeded, failed } = useProviderStatus(extension.providers?.map((provider) => provider.id));

  // The backend refuses every data-changing tool unless it has been told Trading is on. It
  // starts off, so this runs on every load and on every switch; if it cannot be sent, stay off.
  useEffect(() => {
    if (!hasTauriRuntime()) return;
    invokeCommand(invoke, "set_trading_enabled", { enabled: tradingEnabled }).catch(() => {
      if (tradingEnabled) setTradingEnabled(false);
    });
  }, [tradingEnabled]);

  // The trailing stop watcher runs in Rust; it uses 30 seconds until it is told the setting.
  useEffect(() => {
    if (!hasTauriRuntime()) return;
    invokeCommand(invoke, "set_trailing_interval", { seconds: settings.trailingSeconds }).catch(() => {});
  }, [settings.trailingSeconds]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "KeyP" && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.code === "Comma" && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        setView("settings");
        return;
      }
      if (event.code !== "KeyK" || event.shiftKey) return;
      if (!(event.ctrlKey || event.metaKey || event.altKey)) return;
      const input = searchInput.current;
      if (!input) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The mobile menu only exists below 640px; close it when the window grows.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onResize = () => {
      if (window.innerWidth > 640) setMobileNavOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mobileNavOpen]);

  const loadDashboard = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      else setSyncing(true);
      syncingRef.current = true;
      try {
        const result = await invokeCommand(invoke, "load_dashboard");
        // A part that failed this time keeps what the last reload brought, and the status line says so.
        const { dashboard: merged, failures } = keepLastGoodParts(dashboardRef.current, result);
        setDashboard(result.authenticated ? merged : null);
        failedReloadsRef.current = 0;
        if (result.authenticated) {
          setLastUpdated(new Date());
          lastLoadedAtRef.current = Date.now();
          setConnection({ state: "connected" });
          if (failures[0] !== undefined) failed("scalable", failures[0]);
          else succeeded("scalable");
        }
        setError(null);
      } catch (loadError) {
        const message = getErrorMessage(loadError);
        failedReloadsRef.current += 1;
        // With a dashboard on screen the old data stays and the status line shows the failure; the alert is for the sign-in screen.
        if (!dashboardRef.current) setError(message);
        failed("scalable", message);
        setConnection({ state: "error", detail: message });
      } finally {
        syncingRef.current = false;
        setLoading(false);
        setSyncing(false);
      }
    },
    [succeeded, failed],
  );

  useEffect(() => {
    let wasHidden = document.visibilityState === "hidden";
    let lastTick = Date.now();
    const reload = () => {
      if (!syncingRef.current) void loadDashboard(false);
    };
    const resumeAfterSleep = () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      void invokeCommand(invoke, "invalidate_session")
        .catch(() => {})
        .finally(() => {
          syncingRef.current = false;
          if (!document.hidden) void loadDashboard(false);
        });
    };
    const checkWake = () => {
      const now = Date.now();
      const slept = wokeFromSleep(lastTick, now, WAKE_CHECK_MS);
      lastTick = now;
      if (slept) resumeAfterSleep();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        wasHidden = true;
      } else if (wasHidden) {
        wasHidden = false;
        const now = Date.now();
        const slept = wokeFromSleep(lastTick, now, WAKE_CHECK_MS);
        lastTick = now;
        if (slept) resumeAfterSleep();
        else reload();
      }
    };
    const timer = window.setInterval(checkWake, WAKE_CHECK_MS);
    window.addEventListener("online", reload);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", reload);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadDashboard]);

  // Asks Scalable's MCP `ping` tool whether the connection works right now.
  const checkConnection = useCallback(async () => {
    setConnection((previous) => (previous.state === "error" ? previous : { state: "checking" }));
    try {
      const [result] = await callTools(invoke, [{ name: TOOL.ping, arguments: {} }]);
      setConnection(result?.ok ? { state: "connected" } : { state: "error", detail: result?.error ?? "Scalable did not answer the ping." });
    } catch (pingError) {
      setConnection({ state: "error", detail: getErrorMessage(pingError) });
    }
  }, []);

  const toolDefs = dashboard?.toolDefs ?? EMPTY_DEFS;
  const dashboardPortfolios = dashboard?.portfolios;
  const pagePortfolioList = useMemo(() => pagePortfolios(dashboardPortfolios ?? []), [dashboardPortfolios]);
  // After a write only the part it changed is updated: a removal is dropped from the list, an addition reads that one list again.
  const applyChange = useCallback(
    (tool: string, semantic: Rec) => {
      const effect = dashboardEffect(tool);
      const current = dashboardRef.current;
      const fallback = () => void loadDashboard(false);
      const isin = pickString(semantic, ["isin"]);
      if (tool === TOOL.cancelOrder) markCancelled(pickString(semantic, ["portfolioId"]) ?? "", [pickString(semantic, ["transactionId"]), pickString(semantic, ["orderId"])]);
      if (effect === "none") return;
      if (effect === "watchlist-remove" && isin) {
        setDashboard((previous) => previous && withoutWatchlistItem(previous, isin));
      } else if (effect === "watchlist-add" || effect === "watchlist-remove") {
        invokeCommand(invoke, "reload_watchlist", { known: Object.keys(current?.quotes ?? {}) })
          .then((part) => setDashboard((previous) => previous && { ...previous, watchlist: part.watchlist, watchlistError: part.watchlistError, quotes: { ...previous.quotes, ...part.quotes } }))
          .catch(fallback);
      } else if (effect === "groups" && current) {
        invokeCommand(invoke, "reload_groups", { portfolioIds: current.portfolios.map((portfolio) => portfolio.portfolioId) })
          .then((groups) => setDashboard((previous) => previous && { ...previous, groups }))
          .catch(fallback);
      } else {
        fallback();
      }
    },
    [loadDashboard],
  );
  const {
    actions: toolActions,
    ui: toolUi,
    notifications,
  } = useToolActions({ invoke, defs: toolDefs, portfolios: pagePortfolioList, tradingEnabled, inApp: settings.alertToasts, onChanged: applyChange });

  const signedIn = dashboard !== null;
  useAlertWatch({
    invoke,
    defs: toolDefs,
    portfolios: pagePortfolioList,
    enabled: signedIn && settings.alertWatch,
    minutes: settings.alertMinutes,
    toast: settings.alertToasts,
    onTriggered: toolActions.notify,
  });
  const updater = useUpdater({ invoke, launchCheck: settings.checkUpdates, channel: settings.updateChannel, onError: (text) => toolActions.notify({ kind: "error", text }) });
  const background = useBackground({ invoke, onError: (text) => toolActions.notify({ kind: "error", text }) });
  const profile = useToolQuery(invoke, toolDefs, TOOL.getAccountProfile, signedIn && toolActions.has(TOOL.getAccountProfile) ? [{}] : null);
  const accountName = profileName(profile.entries[0]?.outcome.result);
  // The sidebar counts use the same data as the Price alerts and Transactions pages.
  const reloadKey = lastUpdated?.getTime() ?? 0;
  const alertsQuery = useToolQuery(invoke, toolDefs, TOOL.listPriceAlerts, signedIn && toolActions.has(TOOL.listPriceAlerts) ? perPortfolio(pagePortfolioList) : null, reloadKey);
  const alertCount = alertsQuery.entries.some((entry) => entry.outcome.ok) ? collect(alertsQuery.entries).records.length : undefined;
  const transactionHistory = useTransactionHistory({ invoke, defs: toolDefs, portfolios: pagePortfolioList, reloadKey, actions: toolActions });
  const transactionCount =
    toolActions.has(TOOL.listPortfolioTransactions) && (transactionHistory.rows.length > 0 || (!transactionHistory.loading && !transactionHistory.error))
      ? dedupeRows(transactionHistory.rows).length
      : undefined;
  const orderOpen = orderTarget !== null;
  // One reload at a time, re-armed after each run, so a slow reload never queues the next one and failures back off.
  useEffect(() => {
    if (!autoRefresh || !signedIn || orderOpen) return;
    let active = true;
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(tick, nextRefreshDelay(refreshMs, failedReloadsRef.current));
    };
    const tick = async () => {
      if (!document.hidden && !syncingRef.current) await loadDashboard(false);
      if (active) arm();
    };
    arm();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [autoRefresh, refreshMs, signedIn, orderOpen, loadDashboard]);

  useEffect(() => {
    if (!signedIn) return;
    const timer = window.setInterval(() => {
      if (document.hidden || syncingRef.current || !connectionCheckDue(lastLoadedAtRef.current, Date.now(), CONNECTION_CHECK_MS)) return;
      void checkConnection();
    }, CONNECTION_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [signedIn, checkConnection]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void loadDashboard(true);
  }, [loadDashboard]);

  useEffect(() => {
    if (!loginPending) return;
    let active = true;
    let timer = 0;

    const pollStatus = async () => {
      try {
        const status = await invokeCommand(invoke, "login_status");
        if (!active) return;
        if (status.status === "authenticated") {
          setLoginPending(false);
          await loadDashboard(false);
          return;
        }
        if (status.status === "failed") {
          setError(status.error ?? "Scalable sign-in could not be completed.");
          setLoginPending(false);
          return;
        }
      } catch (statusError) {
        if (active) {
          setError(getErrorMessage(statusError));
          setLoginPending(false);
        }
        return;
      }
      if (active) timer = window.setTimeout(pollStatus, 900);
    };

    timer = window.setTimeout(pollStatus, 900);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [loginPending, loadDashboard]);

  const {
    portfolioRows,
    watchlistRows,
    groupData,
    groups: baseGroups,
    defaultGroup: baseDefaultGroup,
    groupErrors,
    overviewData,
    dataIssues,
    todayReturn,
    hasPortfolioValue,
    portfolioTotal,
    totalCurrency,
    diagnostics,
  } = useDashboardData(dashboard, settings.showDiagnostics, groupOrder);
  const moveGroup = useCallback(
    (from: string, to: string) =>
      moveGroupIn(
        baseGroups.map((group) => group.id),
        from,
        to,
      ),
    [baseGroups, moveGroupIn],
  );
  const { defaultGroup, allGroups } = useGroupFigures({
    invoke,
    defs: toolDefs,
    actions: toolActions,
    portfolios: pagePortfolioList,
    reloadKey,
    groups: baseGroups,
    defaultGroup: baseDefaultGroup,
  });
  const common: Common = {
    invoke,
    defs: toolDefs,
    portfolios: pagePortfolioList,
    actions: toolActions,
    tradingEnabled,
    pageSize: settings.pageSize,
    reloadKey,
  };
  const extensionContext = {
    dashboard,
    portfolioRows,
    watchlistRows,
    groups: allGroups,
    settings,
    view,
    reloadKey,
    invoke,
    common,
    signedIn,
    securityTarget,
  };
  const extensionData: ExtensionData = extension.useData?.(extensionContext) ?? {};
  const extensionRuntime: ExtensionRuntime = extension.runtime?.(extensionData) ?? {};
  const tableColumns = settings.tableColumns;
  const market = {
    records: extension.tableColumns?.records(extensionData) ?? new Map<string, MarketRecord>(),
    loading: extensionRuntime.tableLoading ?? false,
    error: extensionRuntime.tableError ?? null,
  };
  const marketTableOpen = extension.tableColumns?.enabled?.(extensionData) ?? extensionRuntime.enabled ?? false;
  // The extension's table data and page results remain visible while a failed request is retried.
  useEffect(() => {
    const provider = extension.providers?.[0]?.id;
    if (!provider || extensionRuntime.loading) return;
    if (extensionRuntime.error) failed(provider, extensionRuntime.error);
    else if (extensionRuntime.enabled) succeeded(provider);
  }, [extensionRuntime.loading, extensionRuntime.error, extensionRuntime.enabled, succeeded, failed]);
  const updateStatus = updater.state.status;
  const updateError = updater.state.status === "error" && !updater.state.info ? updater.state.message : null;
  useEffect(() => {
    if (updateError !== null) failed("updater", updateError);
    else if (updateStatus === "upToDate" || updateStatus === "available") succeeded("updater");
  }, [updateStatus, updateError, succeeded, failed]);
  const retryProvider = (provider: Provider) => {
    if (provider === "scalable") void loadDashboard(false);
    else if (provider === "updater") void updater.check();
    else extensionRuntime.refresh?.();
  };
  const providersBusy = syncing || extensionRuntime.loading === true || updater.state.status === "checking";
  const logos = extensionRuntime.logos ?? new Map<string, string>();
  const isinLogos = extensionRuntime.isinLogos ?? new Map<string, string>();
  const table = useScreenerTable({ view, portfolioRows, watchlistRows, groups: allGroups, pageSize: settings.pageSize, columns: tableColumns, marketRecords: market.records });

  // When the watchlist failed to load, an empty list means "unknown", not "nothing watched".
  const watchlistUnknown = Boolean(dashboard?.watchlistError);
  const watchedIsins = watchlistUnknown ? null : new Set(watchlistRows.map((row) => row.isin).filter(Boolean));
  const heldIsins = new Set(portfolioRows.map((row) => row.isin).filter(Boolean));
  const knownNames = new Map<string, string>();
  const knownSymbols = new Map<string, string>();
  for (const row of [...watchlistRows, ...portfolioRows]) {
    if (row.isin && row.name) knownNames.set(row.isin, row.name);
    if (row.isin && row.symbol) knownSymbols.set(row.isin, row.symbol);
  }
  // The loading bar belongs to the panel that is updating: the Screener only reacts to its own search, and Settings
  // is not reloaded by a data refresh.
  const barBusy = view === "settings" ? loading : syncing || loading || extensionRuntime.loading === true;

  return {
    dashboard,
    loading,
    syncing,
    loginPending,
    setLoginPending,
    error,
    setError,
    connection,
    view,
    setView,
    transactionsOpened,
    mobileNavOpen,
    setMobileNavOpen,
    confirmingSignOut,
    setConfirmingSignOut,
    tradingEnabled,
    setTradingEnabled,
    confirmingTrading,
    setConfirmingTrading,
    orderTarget,
    setOrderTarget,
    nav,
    lastUpdated,
    settings,
    updateSettings,
    resetSettings,
    lightTheme,
    session,
    paletteOpen,
    setPaletteOpen,
    autoRefresh,
    refreshLabel,
    extensionData,
    extensionRuntime,
    securityTarget,
    setSecurityTarget,
    searchInput,
    loadDashboard,
    checkConnection,
    setDashboard,
    toolActions,
    toolUi,
    notifications,
    updater,
    background,
    accountName,
    alertCount,
    transactionCount,
    marketTableOpen,
    portfolioRows,
    watchlistRows,
    groupData,
    baseGroups,
    groupErrors,
    overviewData,
    dataIssues,
    todayReturn,
    hasPortfolioValue,
    portfolioTotal,
    totalCurrency,
    diagnostics,
    defaultGroup,
    allGroups,
    moveGroup,
    tableColumns,
    market,
    logos,
    isinLogos,
    table,
    watchlistUnknown,
    watchedIsins,
    heldIsins,
    knownNames,
    knownSymbols,
    common,
    barBusy,
    providerStatuses,
    retryProvider,
    providersBusy,
  };
}

export type AppData = ReturnType<typeof useAppData>;
