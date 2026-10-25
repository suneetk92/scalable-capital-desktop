import { ShieldCheckIcon } from "@heroicons/react/24/outline";
import { AVATAR } from "../Brand";
import { initialsOf } from "../profile";
import { pluralize } from "../format";
import type { View } from "../nav";
import { btn } from "../ui";
import { TOOL } from "../commands";
import { RefreshButton } from "../controls";
import { extension } from "../extensions";
import { EXCHANGE_HOURS_NOTE } from "../marketHours";
import type { AppCommands } from "./useAppCommands";
import { useApp } from "./AppContext";
import type { AppData } from "./useAppData";

/** The heading of the account menu: the avatar, the name and the number of portfolios. */
export function AccountHeader() {
  const { data } = useApp();
  const { accountName, dashboard } = data;
  const count = dashboard?.portfolios.length ?? 0;
  return (
    <div className="flex items-center gap-2.5 px-2 pt-2 pb-2.5">
      <span className={AVATAR}>{initialsOf(accountName)}</span>
      <div className="grid gap-0.5">
        <strong className="font-semibold text-ink-strong">{accountName ?? "My account"}</strong>
        <small className="text-ink-muted">Scalable Capital · {pluralize(count, "portfolio")}</small>
      </div>
    </div>
  );
}

const ORDER_VIEWS: ReadonlySet<View> = new Set<View>(["overview", "portfolio", "watchlist", "discover", "transactions"]);

/** The buttons next to the page title: the Trading switch, New order and Refresh. Each only appears where it does something. */
export function pageActions(data: AppData, commands: AppCommands) {
  const { view, tradingEnabled, marketOpen, autoRefresh, refreshLabel, syncing, marketTableOpen, market, extensionRuntime } = data;
  const { toggleTrading, openOrder, refreshAccount } = commands;
  const ownView = extension.views?.find((item) => item.id === view);
  const extensionView = ownView !== undefined;
  const ownRefresh = ownView?.refresh?.({ data, commands });
  const refreshExtension = extensionView && !ownRefresh && extensionRuntime.refresh !== undefined;
  const showTrading = view !== "settings" && (!extensionView || ownView.trading === true);
  // New order belongs to the pages about securities and orders; Groups and Savings have their own "New …" action in the panel; New alert and New plan sit here.
  const showNewOrder = showTrading && tradingEnabled && ORDER_VIEWS.has(view);
  const showRefresh = view !== "settings";
  const headerAuto = ownRefresh ? ownRefresh.auto : refreshExtension ? (extensionRuntime.autoRefresh ?? false) : autoRefresh;
  const headerLabel = ownRefresh ? ownRefresh.label : refreshExtension ? (extensionRuntime.refreshLabel ?? "") : refreshLabel;
  const refreshBusy = ownRefresh ? ownRefresh.busy : refreshExtension ? (extensionRuntime.busy ?? extensionRuntime.loading ?? false) : syncing || (marketTableOpen && market.loading);
  const refreshNow = ownRefresh ? ownRefresh.refresh : refreshExtension ? extensionRuntime.refresh! : refreshAccount;
  const lastLoadedAt = ownRefresh ? ownRefresh.lastLoadedAt : refreshExtension ? (view === "screener" ? (extensionRuntime.lastLoadedAt ?? null) : null) : (data.lastUpdated?.getTime() ?? null);
  const intervalMs = ownRefresh ? ownRefresh.intervalMs : refreshExtension ? (extensionRuntime.intervalMs ?? 0) : data.settings.refreshSeconds * 1000;
  if (!showTrading && !showRefresh) return undefined;
  return (
    <>
      {showTrading && (
        <button
          className={btn.mode(tradingEnabled, "warn")}
          type="button"
          role="switch"
          aria-checked={tradingEnabled}
          onClick={toggleTrading}
          disabled={!marketOpen}
          title={
            !marketOpen
              ? EXCHANGE_HOURS_NOTE
              : tradingEnabled
                ? "Trading is on. Every order still needs a preview and your confirmation."
                : "Read-only. Turn on to place orders, change watchlists, price alerts, groups and savings plans, or run other data-changing tools."
          }
        >
          <ShieldCheckIcon aria-hidden="true" /> {tradingEnabled ? "Trading on" : "Read-only"}
        </button>
      )}
      {showNewOrder && (
        <button className={btn.primary} type="button" onClick={() => openOrder("buy", null)}>
          New order
        </button>
      )}
      {view === "alerts" && data.toolActions.has(TOOL.createPriceAlert) && (
        <button className={btn.primary} type="button" onClick={() => data.toolActions.openRunner(TOOL.createPriceAlert, { portfolioId: data.pagePortfolioList[0]?.portfolioId })}>
          New alert
        </button>
      )}
      {view === "savings" && data.toolActions.has("preview_savings_plan") && data.toolActions.has("submit_savings_plan") && (
        <button className={btn.primary} type="button" onClick={() => data.setPlanDialog({ existing: null, portfolioId: data.pagePortfolioList[0]?.portfolioId ?? "" })}>
          New plan
        </button>
      )}
      {showRefresh && <RefreshButton auto={headerAuto} label={headerLabel} busy={refreshBusy} onRefresh={refreshNow} lastLoadedAt={lastLoadedAt} intervalMs={intervalMs} />}
    </>
  );
}
