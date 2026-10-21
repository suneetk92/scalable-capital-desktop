import { Brand } from "./Brand";
import { LoadingShell, PageHeading } from "./controls";
import { MobileNav, Sidebar } from "./Sidebar";
import { SignInScreen } from "./SignIn";
import { TopBar } from "./TopBar";
import { UpdateNotice } from "./UpdateNotice";
import { Alert, field } from "./ui";
import { VIEW_DESCRIPTIONS, VIEW_TITLES, type NavCounts } from "./nav";
import { extension } from "./extensions";
import { initialsOf } from "./profile";
import { AppRouter } from "./app/AppRouter";
import { GlobalDialogs, SecurityDock } from "./app/GlobalDialogs";
import { ProviderStatus } from "./app/ProviderStatus";
import { AccountHeader, pageActions } from "./app/Header";
import { AppProvider } from "./app/AppContext";
import { useAppCommands } from "./app/useAppCommands";
import { useAppData } from "./app/useAppData";
import "./index.css";

function App() {
  const data = useAppData();
  const commands = useAppCommands(data);
  const {
    dashboard,
    loading,
    error,
    setError,
    loginPending,
    view,
    setView,
    mobileNavOpen,
    setMobileNavOpen,
    setConfirmingSignOut,
    setPaletteOpen,
    nav,
    connection,
    session,
    checkConnection,
    notifications,
    updater,
    dataIssues,
    barBusy,
    accountName,
    baseGroups,
    alertCount,
    transactionCount,
    portfolioRows,
    watchlistRows,
    watchlistUnknown,
    providerStatuses,
    retryProvider,
    providersBusy,
  } = data;

  const updateNotice = updater.notice && (
    <UpdateNotice info={updater.notice} state={updater.state} onInstall={() => void updater.install()} onOpenReleasePage={updater.openReleasePage} onDismiss={updater.dismiss} />
  );

  if (loading && !dashboard && !error) {
    return <LoadingShell brand={<Brand size="sm" collapsible className="max-[900px]:justify-center" />} />;
  }

  if (!dashboard) {
    return <SignInScreen busy={loginPending} error={error} notice={updateNotice} onSignIn={() => void commands.signIn()} />;
  }

  const isTableView = view === "portfolio" || view === "watchlist";
  const navCounts: NavCounts = {
    portfolio: portfolioRows.length,
    watchlist: watchlistUnknown ? "—" : watchlistRows.length,
    groups: baseGroups.length,
    alerts: alertCount,
    transactions: transactionCount,
  };
  const account = { header: <AccountHeader />, items: commands.accountItems, name: accountName ?? "My account", initials: initialsOf(accountName) };
  const extensionView = extension.views?.find((item) => item.id === view);
  const title = VIEW_TITLES[view as keyof typeof VIEW_TITLES] ?? extensionView?.title ?? view;
  const description = VIEW_DESCRIPTIONS[view as keyof typeof VIEW_DESCRIPTIONS] ?? extensionView?.description ?? "";

  return (
    <AppProvider data={data} commands={commands}>
      <main className="flex h-screen overflow-hidden bg-canvas">
        <Sidebar view={view} counts={navCounts} nav={nav} connection={connection} sessionInfo={session.info} account={account} onSelect={setView} onCheckConnection={() => void checkConnection()} />

        {mobileNavOpen && (
          <MobileNav
            view={view}
            counts={navCounts}
            navOrder={nav.navOrder}
            onSelect={(id) => {
              setView(id);
              setMobileNavOpen(false);
            }}
            onClose={() => setMobileNavOpen(false)}
            onSignOut={() => {
              setMobileNavOpen(false);
              setConfirmingSignOut(true);
            }}
          />
        )}

        <section className="flex h-screen min-w-0 flex-1 flex-col">
          <TopBar busy={barBusy} notifications={notifications} onOpenMenu={() => setMobileNavOpen(true)} onOpenPalette={() => setPaletteOpen(true)} />

          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 overflow-y-auto">
              <div className="w-full px-8 pt-7.75 pb-5 max-[1080px]:px-5 max-[640px]:px-3.25 max-[640px]:pt-5.5 max-[640px]:pb-4">
                {updateNotice}
                {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}
                <ProviderStatus statuses={providerStatuses} busy={providersBusy} onRetry={retryProvider} />
                {dataIssues.length > 0 && (view === "overview" || isTableView) && (
                  <div className={`${field.note} mb-3.5`} role="status">
                    <strong className="font-semibold">Some data could not be loaded.</strong> Figures marked “—” are missing, and totals only include what did load. Try Refresh.
                    <ul className="mt-1 list-disc pl-5">
                      {dataIssues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <PageHeading title={title} description={description} actions={pageActions(data, commands)} />
                <AppRouter />
                <footer className="mt-4 flex flex-wrap justify-between gap-x-6 gap-y-1 text-caption text-ink-faint">
                  <span className="tracking-wider uppercase">
                    Scalable Capital Desktop <span className="px-1 text-ink-accent">·</span> Personal portfolio view
                  </span>
                  <span>Not affiliated with Scalable Capital. For information only. Not investment advice. © 2026 Suneet Kumar · Apache-2.0</span>
                </footer>
              </div>
            </div>
            <SecurityDock />
          </div>
        </section>
        <GlobalDialogs />
      </main>
    </AppProvider>
  );
}

export default App;
