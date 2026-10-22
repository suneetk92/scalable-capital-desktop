import { ArrowPathIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { AVATAR } from "../Brand";
import { initialsOf } from "../profile";
import { pluralize } from "../format";
import type { View } from "../nav";
import { btn, cx, SPIN } from "../ui";
import { useElapsedShare } from "../countdown";
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

/** Refresh, with a thin bar along its bottom edge that fills up to the next automatic reload. */
function RefreshButton({
  auto,
  label,
  busy,
  onRefresh,
  lastLoadedAt,
  intervalMs,
}: {
  auto: boolean;
  label: string;
  busy: boolean;
  onRefresh: () => void;
  lastLoadedAt: number | null;
  intervalMs: number;
}) {
  const share = useElapsedShare(lastLoadedAt, intervalMs, auto && lastLoadedAt !== null && !busy);
  return (
    <button
      className={cx(btn.mode(auto), "relative overflow-hidden")}
      type="button"
      onClick={onRefresh}
      disabled={busy}
      title={auto ? `Reload now. Data refreshes by itself every ${label}; the bar shows how soon the next reload is. Change this in Settings.` : "Reload the current data now."}
    >
      <ArrowPathIcon aria-hidden="true" className={busy ? SPIN : ""} /> Refresh
      {auto && <span className="font-normal opacity-80">· every {label}</span>}
      {auto && lastLoadedAt !== null && !busy && (
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-ink-heading/10">
          <span className="block h-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${share * 100}%` }} />
        </span>
      )}
    </button>
  );
}

/** The buttons next to the page title: the Trading switch, New order and Refresh. Each only appears where it does something. */
export function pageActions(data: AppData, commands: AppCommands) {
  const { view, tradingEnabled, marketOpen, autoRefresh, refreshLabel, syncing, marketTableOpen, market, extensionRuntime } = data;
  const { toggleTrading, openOrder, refreshAccount } = commands;
  const extensionView = extension.views?.some((item) => item.id === view) ?? false;
  const refreshExtension = extensionView && extensionRuntime.refresh !== undefined;
  const showTrading = view !== "settings" && !extensionView;
  // New order belongs to the pages about securities and orders; Groups, Alerts and Savings have their own "New …" action.
  const showNewOrder = showTrading && tradingEnabled && ORDER_VIEWS.has(view);
  const showRefresh = view !== "settings";
  const headerAuto = refreshExtension ? (extensionRuntime.autoRefresh ?? false) : autoRefresh;
  const headerLabel = refreshExtension ? (extensionRuntime.refreshLabel ?? "") : refreshLabel;
  const refreshBusy = refreshExtension ? (extensionRuntime.busy ?? extensionRuntime.loading ?? false) : syncing || (marketTableOpen && market.loading);
  const refreshNow = refreshExtension ? extensionRuntime.refresh! : refreshAccount;
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
      {showRefresh && (
        <RefreshButton
          auto={headerAuto}
          label={headerLabel}
          busy={refreshBusy}
          onRefresh={refreshNow}
          lastLoadedAt={refreshExtension ? null : (data.lastUpdated?.getTime() ?? null)}
          intervalMs={data.settings.refreshSeconds * 1000}
        />
      )}
    </>
  );
}
