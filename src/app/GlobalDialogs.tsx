import { CommandPalette } from "../CommandPalette";
import { OrderDialog } from "../OrderDialog";
import { SecurityDrawer } from "../SecurityDrawer";
import { extension } from "../extensions";
import { formatMoney, parseSearch } from "../screener";
import { ConfirmDialog, Dock, DockSplit } from "../ui";
import { useApp } from "./AppContext";
import { invoke } from "./invoke";

/** The dialogs that can open on any page: the tool runner, the order, the command palette and the Trading and sign-out questions. */
export function GlobalDialogs() {
  const { data, commands } = useApp();
  const {
    toolUi,
    orderTarget,
    setOrderTarget,
    loadDashboard,
    paletteOpen,
    setPaletteOpen,
    confirmingTrading,
    setConfirmingTrading,
    confirmingStartupTrading,
    setConfirmingStartupTrading,
    setTradingEnabled,
    confirmingSignOut,
    setConfirmingSignOut,
  } = data;
  const { orderPortfolios, paletteItems, signOut } = commands;
  return (
    <>
      {toolUi}
      {orderTarget && (
        <OrderDialog
          target={orderTarget}
          defaultVenue={data.settings.orderVenue}
          portfolios={orderPortfolios}
          invoke={invoke}
          parseSearch={parseSearch}
          formatMoney={formatMoney}
          onClose={() => setOrderTarget(null)}
          onPlaced={() => void loadDashboard(false)}
        />
      )}
      {paletteOpen && <CommandPalette items={paletteItems()} onClose={() => setPaletteOpen(false)} />}
      {confirmingTrading && (
        <ConfirmDialog
          title="Enable trading?"
          text="Trading turns off read-only mode. You will be able to place buy and sell orders, change watchlists, price alerts, portfolio groups and savings plans, and run other tools that change data on your real Scalable Capital account. Every order still needs a preview and your confirmation. Trading switches back to read-only the next time the app starts, unless you turn on Trading at start in Settings."
          confirmLabel="Enable trading"
          onConfirm={() => {
            setConfirmingTrading(false);
            setTradingEnabled(true);
          }}
          onCancel={() => setConfirmingTrading(false)}
        />
      )}
      {confirmingStartupTrading && (
        <ConfirmDialog
          title="Enable trading at start?"
          text="Trading will be on now and every time the app starts, while the exchange is open. You will be able to place buy and sell orders, change watchlists, price alerts, portfolio groups and savings plans, and run other tools that change data on your real Scalable Capital account. Every order still needs a preview and your confirmation."
          confirmLabel="Enable trading at start"
          onConfirm={() => {
            setConfirmingStartupTrading(false);
            data.updateSettings({ tradingAtStart: true });
            if (data.marketOpen) setTradingEnabled(true);
          }}
          onCancel={() => setConfirmingStartupTrading(false)}
        />
      )}
      {confirmingSignOut && (
        <ConfirmDialog
          title="Sign out?"
          text="You will be disconnected from Scalable Capital and need to sign in again to view your portfolio."
          confirmLabel="Sign out"
          onConfirm={() => void signOut()}
          onCancel={() => setConfirmingSignOut(false)}
        />
      )}
    </>
  );
}

/** The side panel: market data on the Screener, and the details of the security that was opened. */
export function SecurityDock() {
  const { data, commands } = useApp();
  const { dashboard, view, securityTarget, setSecurityTarget, common } = data;
  const { tradeFound } = commands;
  const extensionView = extension.hasDock(view) ? extension.views?.find((item) => item.id === view) : undefined;
  const extensionContext = { data, commands };
  if (!dashboard || (!extensionView && !securityTarget)) return null;
  return (
    <Dock label={extensionView ? `${extensionView.title} and security details` : "Security details"} overlay={securityTarget !== null}>
      <DockSplit
        top={extensionView && extension.dock ? <extension.dock context={extensionContext} /> : null}
        bottom={
          securityTarget && (
            <SecurityDrawer
              target={securityTarget}
              quote={dashboard.quotes?.[securityTarget.isin]}
              common={common}
              extensionContext={extensionContext}
              formatMoney={formatMoney}
              onClose={() => setSecurityTarget(null)}
              onTrade={(side) => tradeFound({ isin: securityTarget.isin, name: securityTarget.name }, side)}
            />
          )
        }
      />
    </Dock>
  );
}
