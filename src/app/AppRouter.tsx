import { lazy, Suspense } from "react";
import { SkeletonRows } from "../controls";
import { OverviewPage } from "../Overview";
import { OverviewExtras } from "../OverviewExtras";
import { SummaryStats } from "../SummaryStats";
import { ScreenerTable } from "../ScreenerTable";
import { extension } from "../extensions";
import { columnById, MARKET_CURRENCY } from "../marketColumns";
import { formatMoney } from "../screener";
import { useApp } from "./AppContext";

const GroupsPage = lazy(() => import("../pages/Groups").then((module) => ({ default: module.GroupsPage })));
const DiscoverPage = lazy(() => import("../pages/Discover").then((module) => ({ default: module.DiscoverPage })));
const AlertsPage = lazy(() => import("../pages/Alerts").then((module) => ({ default: module.AlertsPage })));
const SavingsPage = lazy(() => import("../pages/Savings").then((module) => ({ default: module.SavingsPage })));
const TransactionsPage = lazy(() => import("../pages/Transactions").then((module) => ({ default: module.TransactionsPage })));
const SettingsPage = lazy(() => import("../SettingsPage").then((module) => ({ default: module.SettingsPage })));

/** Shown while the code of a page loads. */
function PageFallback() {
  return <SkeletonRows rows={5} columns={4} label="Loading page…" />;
}

/** The page for the current view. Only the Overview, Portfolio and Watchlist (the first screens) are in the main bundle; the others load when they are first opened. */
export function AppRouter() {
  const { data, commands } = useApp();
  const {
    dashboard,
    view,
    setView,
    transactionsOpened,
    searchInput,
    portfolioRows,
    watchlistRows,
    groupData,
    groupErrors,
    overviewData,
    todayReturn,
    hasPortfolioValue,
    portfolioTotal,
    totalCurrency,
    defaultGroup,
    allGroups,
    watchlistUnknown,
    watchedIsins,
    heldIsins,
    knownNames,
    knownSymbols,
    common,
  } = data;
  const { openGroup, openFound, tradeFound } = commands;
  const extensionContext = { data, commands };
  const extensionView = extension.views?.find((item) => item.id === view);
  if (!dashboard) return null;
  // The Groups tools are offered by Scalable only for some accounts.
  const groupsOffered = (dashboard.tools ?? []).some((tool) => /group/i.test(tool));
  const overviewFailed = dashboard.portfolios.some((portfolio) => portfolio.overviewError);

  return (
    <Suspense fallback={<PageFallback />}>
      {view === "overview" && (
        <SummaryStats
          hasPortfolioValue={hasPortfolioValue}
          portfolioTotal={portfolioTotal}
          totalCurrency={totalCurrency}
          portfolioCount={dashboard.portfolios.length}
          todayReturn={todayReturn}
          positions={portfolioRows.length}
          watchlistUnknown={watchlistUnknown}
          watchlistCount={watchlistRows.length}
        />
      )}

      {view === "overview" && (
        <OverviewPage
          data={overviewData}
          totalCurrency={totalCurrency}
          overviewFailed={overviewFailed}
          groups={allGroups}
          portfolioRows={portfolioRows}
          groupErrors={groupErrors}
          groupsOffered={groupsOffered}
          onOpenGroup={openGroup}
          onOpenGroups={() => setView("groups")}
        />
      )}
      {view === "overview" && <OverviewExtras common={common} currency={totalCurrency} logosEnabled={Boolean(extension.logos?.useIsinLogos)} />}
      {view === "groups" && <GroupsPage common={common} data={groupData} defaultGroup={defaultGroup} errors={groupErrors} offered={groupsOffered} formatMoney={formatMoney} onShowGroup={openGroup} />}
      {view === "discover" && (
        <DiscoverPage
          key={data.discoverSearch?.run ?? 0}
          common={common}
          initialQuery={data.discoverSearch?.query}
          watched={watchedIsins}
          held={heldIsins}
          onOpen={openFound}
          onTrade={(found) => tradeFound(found)}
        />
      )}
      {view === "alerts" && <AlertsPage common={common} searchInput={searchInput} onOpenSecurity={openFound} />}
      {view === "savings" && <SavingsPage common={common} searchInput={searchInput} dialog={data.planDialog} onDialog={data.setPlanDialog} onOpenSecurity={openFound} />}
      {transactionsOpened && (
        <div hidden={view !== "transactions"}>
          <TransactionsPage
            logosEnabled={Boolean(extension.logos?.useIsinLogos)}
            common={common}
            knownNames={knownNames}
            knownSymbols={knownSymbols}
            searchInput={view === "transactions" ? searchInput : undefined}
            onOpenSecurity={openFound}
          />
        </div>
      )}
      {view === "settings" && <SettingsRoute />}
      {extensionView?.render(extensionContext)}

      {(view === "portfolio" || view === "watchlist") && <PortfolioRoute />}
    </Suspense>
  );
}

function SettingsRoute() {
  const { data, commands } = useApp();
  return (
    <SettingsPage
      settings={data.settings}
      marketOpen={data.marketOpen}
      onChange={data.updateSettings}
      onChangeStartAccess={commands.chooseStartAccess}
      onReset={data.resetSettings}
      session={data.session}
      common={data.common}
      diagnostics={data.diagnostics}
      onCopyText={(text, done) => void commands.copyText(text, done)}
      onCopyToken={() => void commands.copyToken()}
      onSignOut={() => data.setConfirmingSignOut(true)}
      onSelectView={data.setView}
      updater={data.updater}
      background={data.background}
      extensionSection={extension.settingsSection ? <extension.settingsSection context={{ data, commands }} /> : undefined}
    />
  );
}

function PortfolioRoute() {
  const { data, commands } = useApp();
  const view = data.view === "portfolio" || data.view === "watchlist" ? (data.view as "portfolio" | "watchlist") : null;
  if (!view) return null;
  const onChangeColumns = (columns: string[]) => {
    const key = view === "watchlist" ? "watchlistColumns" : "tableColumns";
    const hidden = data.settings[key].filter((id) => !columnById(id) && !extension.tableColumns?.column(id));
    data.updateSettings({ [key]: [...columns, ...hidden] });
  };
  return (
    <ScreenerTable
      view={view}
      table={data.table}
      columns={view === "watchlist" ? data.settings.watchlistColumns : data.settings.tableColumns}
      extensionEnabled={data.marketTableOpen}
      marketRecords={data.market.records}
      logos={data.logos}
      isinLogos={data.isinLogos}
      extensionLoading={data.market.loading}
      extensionError={data.market.error}
      extensionCurrency={MARKET_CURRENCY}
      onChangeColumns={onChangeColumns}
      groups={data.allGroups}
      watchlistUnknown={data.watchlistUnknown}
      tradingEnabled={data.tradingEnabled}
      manageEnabled={data.manageEnabled}
      toolActions={data.toolActions}
      lastUpdated={data.lastUpdated}
      showDiagnostics={data.settings.showDiagnostics}
      searchInput={data.searchInput}
      invoke={data.common.invoke}
      watchedIsins={data.watchedIsins}
      heldIsins={data.heldIsins}
      onSelectView={data.setView}
      onOpenDiscover={data.openDiscover}
      onCopyCsv={commands.copyCsv}
      onBulkAddToGroup={commands.bulkAddToGroup}
      onBulkWatchlist={commands.bulkWatchlist}
      onOpenSecurity={commands.openSecurity}
      onOpenFound={commands.openFound}
      onOpenOrder={commands.openOrder}
      onRefresh={() => void data.loadDashboard(false)}
      onMoveGroup={data.moveGroup}
      onMoveHolding={commands.moveHolding}
    />
  );
}
