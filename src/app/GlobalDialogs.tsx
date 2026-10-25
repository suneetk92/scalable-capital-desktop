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
    setAccessSwitch,
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
          title="Enable full access?"
          text="Full access lets you place buy and sell orders and change savings plans, besides changing watchlists, price alerts and portfolio groups, and run other tools that change data on your real Scalable Capital account. It only works while the exchange is open; after closing, the app drops to Restricted access. Every order still needs a preview and your confirmation. The app starts read-only again, unless you turn on Trading at start in Settings."
          confirmLabel="Enable full access"
          onConfirm={() => {
            setConfirmingTrading(false);
            setAccessSwitch("full");
          }}
          onCancel={() => setConfirmingTrading(false)}
        />
      )}
      {confirmingStartupTrading && (
        <ConfirmDialog
          title="Start with full access?"
          text="Every launch will start with Full access while the exchange is open (Restricted otherwise). You will be able to place buy and sell orders, change savings plans, watchlists, price alerts and portfolio groups, and run other tools that change data on your real Scalable Capital account. Every order still needs a preview and your confirmation."
          confirmLabel="Start with full access"
          onConfirm={() => {
            setConfirmingStartupTrading(false);
            data.updateSettings({ startAccess: "full" });
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
