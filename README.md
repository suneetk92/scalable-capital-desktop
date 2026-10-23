# Scalable Capital Desktop

A desktop app (Tauri 2, React 19, Tailwind CSS 4) for your Scalable Capital portfolio, watchlist and
groups. It is a client of Scalable's MCP server, signs in with your own account and keeps everything
on your machine.

**Platforms.** Every release has builds for Windows (x64), macOS (Apple Silicon and Intel) and Linux (x64
and arm64). Only Windows has been tested; the macOS and Linux builds come from CI and have never been run.

> **Disclaimer.** Scalable Capital Desktop is an independent, unofficial project. It is **not affiliated with,
> endorsed by or supported by Scalable Capital**. It talks to Scalable's MCP server using your own
> account and your own sign-in. For information only, **not investment advice**. Orders are real
> orders in your real account; you are responsible for every one you place. The activity and realised
> figures are not a tax statement: average-cost figures can differ from broker tax-lot calculations,
> including FIFO. Check them with Scalable or a tax adviser. The software is provided as is, without
> warranty.

## Contents

- [Features](#features)
- [Getting started](#getting-started)
- [Project layout](#project-layout)
- [How sign-in works](#how-sign-in-works)
- [Trading](#trading-buy-and-sell)
- [Diagnostics and logging](#diagnostics-and-logging)
- [Scalable MCP access and known limits](#scalable-mcp-access-and-known-limits)
- [Development checks](#development-checks)
- [Building and releases](#building-and-releases)
- [App icon](#app-icon)
- [More documents](#more-documents)
- [License](#license)

## Features

- **Sign-in** with Scalable Capital's OAuth server (`https://mcp.scalable.capital`): Dynamic Client
  Registration, PKCE (S256) and a loopback redirect (`http://127.0.0.1:43127/`). Tokens are kept in
  the OS keyring and the session is restored on the next start.
- **Portfolio and Watchlist tables**: sorting, search (Ctrl+K or Alt+K), a Filters menu (gainers or
  losers only, "Also held in portfolio" on the Watchlist, a group filter, and "Divide rows into groups" on
  the Portfolio), row selection with bulk actions (add to a group, add to or remove from the watchlist,
  Copy CSV), Copy CSV for the rows shown, and an "Updated" time. The Refresh button next to the page title
  shows "every 1 min" when the Scalable auto-refresh is on, with a thin bar along its bottom edge that drains to empty when the next automatic reload happens, which you switch in the account menu or
  Settings. The loading bar at the top shows only for the panel that is updating. Crypto holdings with a
  positive amount are listed too. All columns come from Scalable: price and change % are shown by default,
  and the **+** in the table header adds more from the "From Scalable" group (bid, ask and spread %, taken from the quote that
  the refresh already reads, so they cost no extra calls; quantity, market value,
  average price, total cost, gain or loss in money and percent, and security type; the cost and gain
  columns are for the Portfolio tab and show a dash where Scalable gives no cost). The column picker has a
  search box and **Select all**, and unticking removes a column. Every column sorts, the choice is
  remembered, and Copy CSV exports the columns shown. Each security is shown with its two-letter monogram
  initials. The tables render only rows in or near the viewport; selection and CSV still cover every row.
  Scalable's watchlist is a single flat list: its MCP offers list, add and remove only, so the app cannot
  group watchlist entries (portfolio groups hold holdings only).
- **Overview**: returns by timeframe as reported by Scalable, cash and buying power, a plain **Top movers** card (one list in descending order: the biggest gainer first, the biggest loser last), a **Holdings** card (market value, cost, gain since buy, price change today, the share of the five largest positions, best and worst position; the per-position figures are columns of the Portfolio table, including **Share** and **Today**; they are worked out from the holdings already loaded, in `src/holdings.ts`, and cost and gain cover only the holdings for which Scalable reports a since-buy figure, which the card says; mixed-currency totals are not converted), your groups, **Trading**, **Income and cash** and **By security** cards worked out from all your
  transactions (bought, sold and net invested, fees and taxes, dividends and interest, deposits and withdrawals, and per security the
  average buy price and **Realised (avg. cost)**; this is not a tax-lot calculation. The By security table is split into pages by the "Rows per page" setting; By security shows each security the way the Portfolio table and Transactions do, as monogram initials with the ISIN in bold and the name below; every paged table, also Transactions and the record tables, sorts by a clicked column header across all pages, and a third click restores the original order), the account profile, the overnight summary and fixed-term
  accounts. The activity figures use every transaction of each portfolio, broker and crypto, with no limit: `list_portfolio_transactions` has no "fetch all" option, only `pageSize` (1 to 100, default 20) and a cursor, so the first load reads all pages at 100 each, newest first. The history is then stored in the webview's IndexedDB (a compact copy, one entry per portfolio, the newest 10,000 transactions of each; cleared on sign-out; it falls back to memory when IndexedDB is unavailable, and an older copy in local storage is moved over once and removed) and shown at once on the next start; a refresh fetches only the newest pages, up to the first one with nothing new or changed, and **Reload all** forgets the stored copy and reads everything again. The first full load saves a checkpoint every few pages, so closing the app halfway (or leaving the Overview) keeps what was read and the next visit carries on from there. After a long gap the refresh stitches however many new transactions arrived (for example 500, six pages) onto the stored history. Settings, Data and refresh, has **Clear stored transactions** to throw the stored copy away if a figure looks wrong; the next Overview visit then reads everything again. The figures count a swap in as a buy and a swap out as a sell, and skip open, cancelled and rejected orders and types they do not recognise,
  say how many of all the transactions they counted (the same total as the sidebar and the Transactions page) and list what was left out, by type; the calculations are in `src/activity.ts` and the loading and storing in `src/activityCache.ts` (on the small async store in `src/kvStore.ts`). Scalable's transactions carry no separate fee or tax field, so fees and taxes are the fee and tax cash transactions among them. If Scalable fails to deliver part of it, a notice says so instead of showing zeros.
  The Overview also has an overnight transactions card with server-side search, type and period filters, and cursor-based paging.
- **Groups**: list, create, rename, delete, add and remove holdings, group details. The Portfolio
  table can be divided into collapsible sections per group. Drag a group's header to reorder the groups (or focus it and
  press Alt+Up / Alt+Down); the order is kept on this computer only and is used wherever groups are listed, with Default
  always last. While Trading is on, drag a holding row onto another group's section to move it there (it is added to that
  group and removed from its old one; dropping it on Default only removes it from its group); Escape cancels a drag.
  Holdings that are in no group form a built-in
  "Default" group, which is laid out like the other groups (its value, share and since-buy gain are worked out from your holdings, and pending orders and savings plans are counted from the order and savings plan lists; each holding has a "+" menu to add it to a group). Any group Scalable reports no value, since-buy gain, pending orders or savings plan amount for gets them the same way (open orders are read from the first 100 transactions of each portfolio), shown last on Overview, Groups and Portfolio and available as a group filter.
  Negative since-buy returns are shown in red.
- **Price alert notices**: Scalable's MCP has no push or webhook channel, so while the app runs and
  you are signed in it calls `list_price_alerts` (with `activeOnly: false`) every few minutes (5 by
  default, 1 to 30 in Settings) and announces each alert whose `triggeredTimestampUtc` is set, as its
  own entry in the notification center and a Windows notification (the in-app toast is optional, see Settings, Background; it appears anyway when the Windows notification cannot be shown). At
  start the app registers its identifier with Windows for the current user (`HKCU\Software\Classes\AppUserModelId`), because Windows drops toasts from an unregistered app without an error. Settings, Background has a button that sends a test notification. Alerts that fired while the app was closed are announced
  at the next start; the very first check only records alerts that had fired already. Scalable's own
  push message to the phone stays the primary alert. It is an unconfirmed guess that Scalable fills
  `triggeredTimestampUtc` once an alert fires, because no fired alert has been seen yet.
- **Background**: the app has a tray icon (Windows notification area). By default the close button hides
  the window and the app keeps running, so the alert check goes on; click the tray icon to open the window
  again and use Quit in its menu to exit. The first time you close to the tray, a Windows notice explains
  that the app is still running and points to Quit. Settings, Background can turn that off (the close button then quits),
  start the app with Windows (registered for the current user; the launch passes `--autostart`) and make that
  start open no window, only the tray icon. These options are saved by the Rust side in `background.json` in the
  app config folder, because they apply before the webview has loaded. Starting a second copy shows the window of the
  running one. A hidden window keeps the alert check running; Scalable auto-refresh pauses while it is hidden.
  Returning to the window or reconnecting to the network triggers one dashboard refresh. When a delayed timer tick
  indicates the computer slept, the app drops its cached MCP session before reloading. Quit from the tray waits up to
  20 seconds for a trailing-stop sale already in progress, then exits. The auto-refresh runs
  one reload at a time and re-arms after each; when a reload fails, the next one waits twice as long (up to
  10 minutes) until one succeeds, and the minute-by-minute connection check (`ping`) is skipped while a reload
  answered within the last minute.
- **Notification center**: the bell at the top right of every page keeps the notices of the session,
  newest first, with a count on the bell. It lists what you did and what happened: price alerts added (with
  the security and price), removed, triggered, tool results and errors. Every new notice is
  sent as a Windows notification. It also appears as a stacked toast at the bottom right only when
  Settings, Background, "Also show in the app" is on, or when Windows cannot show the notification (toasts
  go away after a few seconds; errors stay until dismissed). Clear all or remove
  single entries from the panel. The history is not saved between launches.
- **Discover** (securities and derivatives), **Price alerts**, **Trailing stops**, **Savings plans** (list, options,
  guided create and edit with Scalable's preview, removal) and **Transactions** (table or timeline, details, cancel open
  orders). The list is the history stored on this computer (the same one the Overview uses, newest first), so
  the pages cover every transaction at once and the count is the real total. It is brought up to date in the
  background, and while the first full load runs the page shows its progress. Switching to another page and back keeps
  the filters and the page you were on. The table and the timeline show one page of rows at a time (the "Rows per page" setting), a long history is turned into rows in slices (`src/chunked.ts`) so the page stays responsive, and Copy CSV still covers every row the filters match.
  The toolbar matches the Portfolio table: Table/Timeline tabs, a search box (Ctrl+K) for ISIN or name, a
  Filters menu for type and status, and Copy CSV. Filters apply to every stored transaction.
  Any form with a portfolio id field (Discover, tool runner, savings plan) shows a portfolio
  drop-down with the main portfolio preselected.
- **Switching pages does not reload data.** Opening a page from the sidebar shows what it already loaded: the
  Overview, Price alerts and Savings plans are asked for again only after Refresh, the auto-refresh timer, or a
  change of filters.
- **A failed refresh keeps the last good data.** If a reload fails, the Overview, tables and lists keep showing what the last
  one brought (a part that failed, such as the watchlist, a portfolio's overview or the groups, keeps its earlier value, and
  so does a tool query), and a line under the page title says which service is affected, for example "Scalable data as of 14:32 ·
  refresh failed", "Scalable unavailable" or "Update check failed", with a Retry button that reloads just that service.
  The status is kept in memory only (`src/providerStatus.ts`, `src/lastGood.ts`); nothing is stored, and error texts are
  stripped of anything that looks like a token.
- **A change you make does not reload everything.** After a successful write, a removal (price alert, savings plan,
  watchlist item) is taken out of the list on screen at once, and an addition reads only the list it changed
  (price alerts, savings plans, the watchlist with its new quotes, or the groups). The rest of the dashboard stays as it is.
  Cancelling an open order marks that transaction as cancelled in the stored history and on the Transactions page, with no reload.
  Only writes with no such list still reload the dashboard.
- **Security details** panel: opening a security (from a table row, the Transactions page or the command palette)
  shows its details in a right column docked under the top bar, in this order: Scalable's news, the price chart, an
  Overview (bid, ask and the performance by period) and the trading venues, in one scrollable column. Drag the
  column's left edge (or use the arrow keys on it) to change the width; double-click resets it. The width is
  remembered, and the panel closes when you switch to another page. Below 900px the column is hidden until a
  security is opened, then it covers the page. Its footer has watchlist and price-alert shortcuts, and **Buy** and
  **Sell** while Trading is on. The price chart is drawn with the open-source Lightweight Charts library and is
  interactive: hover, touch or the arrow keys show the value and time of one point and its change since the start
  of the range.
- **Scalable tools** (Settings, Scalable tools): every MCP tool the connection offers. A tool name is green when the app uses it and red when it does not, and a link jumps to the page that uses it. The table also shows
  how often this window called them (split into pages by the "Rows per page" setting), a connection test (`ping`), a **Schema** button and a Run button that builds a form
  from the tool's own input schema. Schema fetches the tool list from Scalable when you open it (nothing is stored in the app) and shows the arguments, the input schema and the output schema, with a Reload button. Tools that change data ask for confirmation and require the Trading switch.
- **Command palette** (Ctrl+P): jump to a page, run common actions or open a security by name.
- **Settings** (Ctrl+,): theme (dark, light, system), font size and family, table density,
  the Scalable auto-refresh and its interval (15 s to 10 min), rows per page (10 by default, used by the
  Portfolio, Watchlist, Transactions, Price alerts and Savings plans tables, the Overview's By security
  tables and Scalable tools; "All rows" shows every row), the stored transactions, Data diagnostics, the Background
  options (tray, start with Windows), the price alert notices with their check interval and in-app toast, the
  trailing stop check frequency, the default trading venue, the Trading switch and the update check, with a reset to
  defaults (Rust keeps the Background options, so the reset leaves them). The sidebar can be reordered by drag and
  drop or Alt+Up and Alt+Down.
- **Session** (Settings, Session): live countdown of the access-token validity, when the refresh
  token was last renewed (Scalable does not publish its lifetime, so no expiry is invented), "Renew
  now" and "Sign out". The panel never receives a token.
- **Data diagnostics** (Settings, Data and refresh, off by default): shows the raw Scalable data in
  Settings, Data and refresh, "Raw data", and in tool results, the security panel and the order
  dialog. It also adds a copy button for the access token in Settings, Session. The refresh token never
  leaves Rust.
- **Updates**: on launch the app asks this repository's GitHub Releases once whether a newer signed version
  exists (installed copies only, never in `tauri dev`). A dismissible notice offers **Install and restart**;
  Settings, Keyboard and about has a **Check for updates** button and the "Check for updates on launch" switch.
  The app offers stable releases only. **Reinstall** next to it downloads the current release again and installs it
  over the running one, also when the version number is the same (for example after a release was uploaded again).
  See "Updates and signing" below.
- **Local only**: settings live in the webview's localStorage under the `scalable-capital-desktop.` prefix
  (`settings`, `nav-order`, `group-order`, `panel-width`, `panel-split`, `alerts-notified`), through the shared
  `src/storage.ts` helpers; the transaction history lives in IndexedDB (database `scalable-capital-desktop.cache`),
  with `activityCache.ts` using localStorage only to move legacy history once. Nothing is sent anywhere except to
  Scalable and to GitHub for the update check.
  The `settings` value and the Rust `background.json` carry a schema `version`; older files (without one)
  are read as version 0 and brought up to date by one migration step per version, and an unreadable value is
  kept aside (`settings.bad`, `background.bad`) instead of being overwritten by the defaults.

## Getting started

Requirements: Node.js 22, a Rust toolchain (1.99 or newer) and the
[Tauri 2 prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm install
npm run tauri dev      # full desktop app (needed for sign-in)
npm run dev            # frontend only, in a browser at http://localhost:1420
```

- **Sign-in only works in the desktop window.** A plain browser has no Tauri runtime
  (`window.__TAURI_INTERNALS__` is undefined), so "Continue with Scalable Capital" shows a message
  explaining this instead.
- **Scalable Capital Desktop is a desktop-only app, by design.** Scalable's MCP server rejects browser
  requests (CORS), and the tokens and the Trading gate belong in the Rust process and the OS keyring.
  `npm run dev` is only for working on the UI with mocked data.
- **Linux, "Failed to initialize GTK"** means there is no graphical display (for example an SSH
  session with an empty `$DISPLAY`). Run from a desktop session, use `ssh -X`, or for a smoke test
  `xvfb-run -a npm run tauri dev`.
- Keep the `@tauri-apps/*` npm packages and the `tauri*` crates on the same minor version; `npm run check:tauri`
  checks the API, CLI and opener versions in both lockfiles. To update them, use
  `cargo update -p tauri -p tauri-build -p tauri-plugin-opener -p tauri-plugin-updater` in `src-tauri`.
- CI also runs `cargo deny check` (`src-tauri/deny.toml`: permissive licences only, crates.io only, duplicate
  versions as warnings). When a new dependency brings a licence the list does not have, add it there if it is
  permissive; `cargo install cargo-deny` runs the same check locally.

## Extensions

Optional features live in `extensions/`, each with its own `extension.json` (id, name, version, description)
and its own version, kept apart from the app version. **Settings > About > Extensions** lists the installed
ones with their versions.

- `extensions/trailing-stops/` is public and bundled in every build (see `bundled-extensions.json`): the trailing
  stop loss and buy stop, in TypeScript (`web/`) and Rust (`src-tauri/`). Its README has the details.
- Another extension can join a build from a local folder; it is not part of this repository.

Change an extension's version with `node scripts/set-extension-version.mjs <id> X.Y.Z`. Extensions are compiled
into the app, so a new extension version reaches users with the next app release; updating an extension alone
would need a separate loader and feed, which the app does not have.

## Project layout

```text
src/                 React frontend (TypeScript, Tailwind-only styling)
  App.tsx            thin shell: the sign-in and loading screens and the page layout
  app/               useAppData (state, timers, data hooks), useAppCommands (refresh, copy, orders, bulk edits, sign in and out, palette and menu entries), AppContext (shared data/commands and route wrappers), AppRouter (the page for the view; the pages other than Overview, Portfolio and Watchlist load lazily), GlobalDialogs (order, palette, confirmations, security dock), Header (page buttons, account menu heading), ProviderStatus (the service status line), invoke.ts (the `invoke` that fails with a clear message outside the desktop window)
  commands.ts        typed registry of the Tauri commands (`CommandMap`, `invokeCommand`) and the names of the Scalable tools used in more than one file; a test checks it against `generate_handler!` in `src-tauri/src/lib.rs` (tested)
  Sidebar, TopBar, SignIn, Brand, Overview, OverviewExtras, SummaryStats, ScreenerTable, ScreenerRow, SecurityDrawer, SettingsPage, ...   screens and chrome; the Portfolio and Watchlist table (ScreenerTable, ScreenerRow) and the Overview cards are separate modules
  pages/             Groups, Alerts, Savings (+ plan dialog), Transactions, Tools and ToolSchema (shown in Settings), Discover
  hooks/             dashboard data, async query and preview flows, table state, overnight transactions, transaction history, windowed table rows (`useRowWindow.ts`), group figures and order, price alert watch, trailing stops, notifications, provider status, sidebar order, session info, updater, background options
  extensions.ts      typed extension slots (extra pages, table columns, security-panel sections, settings and menu entries) and the list of installed extensions; the app works without any extension
  composeExtensions.ts   combines the installed extensions into the one the app talks to (tested)
  refreshOptions.ts  the check-frequency choices and their labels, with no imports
  providerStatus.ts  per-service status (Scalable, updater): last success, last error, ok / stale / failed (tested); lastGood.ts keeps the last good data of a failed reload (tested)
  kvStore.ts, chunked.ts   the small async key-value store over IndexedDB with a memory fallback, and sliced processing for long lists (both tested)
  updates.ts         update state, progress and messages (tested); UpdateNotice.tsx is the notice
  marketColumns.ts   the table columns (the "From Scalable" group) and their sort and export values
  screener.ts        pure data helpers for the Portfolio and Watchlist rows: JSON walkers, row building (tested)
  format.ts          shared locale, number/date formatters, decimal parser and pluralize helper (tested)
  tools.ts           tool schemas, argument building, tool-call helpers (tested)
  response.ts        reading tool answers defensively: JSON text, record lists, `pick`/`pickString`/`pickNumber`, and the alias table that maps the names different tools use for quantity and prices to one name (tested)
  groups.ts, settings.ts (with the stored schema version and migrations), session.ts, alerts.ts, notifications.ts, order.ts (order ticket limits), refreshSchedule.ts (auto-refresh backoff), countdown.ts (the Refresh button bar), rowWindow.ts (table row windows), trailing.ts, transactions.ts, savingsPlan.ts, storage.ts   pure logic with tests
  ui.tsx, controls.tsx   shared Tailwind building blocks (buttons, icon buttons, fields, search box, tables, sortable headers, panels, dialogs and their footer, menus, the docked right column)
  LineChart.tsx      the price chart of the security details
  index.css          theme tokens (dark and light), keyframes and custom variants
src-tauri/           Rust backend
  src/auth.rs        OAuth, token storage in the keyring, session info
  src/mcp/           MCP client, session pool, dashboard loading, trading gate (`trading.rs`), savings plans, input-schema argument validation and preview state; `response.rs` has the shared readers for tool answers (records, strings, numbers, tool names; tested)
  src/notify.rs      `show_notification`: desktop notices (the webview cannot use the notification plugin itself); registers the Windows app ID
  src/background.rs  tray icon, close to the tray, start with Windows (`get_background`, `set_background`; the webview cannot use the autostart plugin itself)
  src/updates.rs     `check_for_update` and `install_update`: signed updates through the updater plugin (the webview cannot use the plugin itself)
  src/logging.rs     small log file with rotation, redaction and panic capture
  src/diagnostics.rs `export_diagnostics` and `open_log_folder`: the sanitised bug-report text and the log folder button
  src/files.rs       atomic writes of the app's own files
  capabilities/      Tauri permissions (only core defaults and opening https links)
  tauri.updater.conf.json   CI-only overlay that turns on the signed updater files
  icons/             app icon: app-icon.svg is the master, the rest is generated
tests/fixtures/       Scalable's published tool list (a saved tools/list response) and the read/write tool policy, read by the tests only
scripts/             check-exports.mjs: no unused exports (tested); check-tauri-versions.mjs: checks npm/Cargo Tauri minors (tested); set-version.mjs: writes a version into the three version fields; make-latest-json.mjs: writes the updater's manifest (tested); release-notes.mjs: writes a release's notes from the commits since the previous release (tested); publish-github-release.sh: publishes the release files to this repository's GitHub Releases with `gh`
.github/workflows/   CI and release pipelines
```

Styling is Tailwind CSS 4 utilities only. Both themes are semantic colour tokens in `src/index.css`
(`html[data-theme="light"]` overrides the dark values). Sizes use `rem` and `em`, so the font-size
setting scales everything (the root font size is 15px, so a former `18px` is `[1.2rem]`; `src/styleRules.test.ts`
fails on new `-[12px]` arbitrary values, and only viewport breakpoints, shadows and 1px borders stay in px),
and table density is a custom `compact:` variant. All dialogs go through `ModalFrame` (sizes `sm`, `md`, `lg`) with a
`DialogFooter` (Cancel, Back or Close first, the primary action last); icon-only buttons are `IconButton`. Shared building blocks
are based on Tailwind Plus Application UI templates and Headless UI. The Portfolio and Watchlist tables keep their sort and row selection in TanStack Table (`@tanstack/react-table`, headless, in `src/hooks/useScreenerTable.ts`); the markup, column resizing and ordering, grouping and paging are the app's own. The price chart uses the open-source Lightweight Charts library (`lightweight-charts`, in `src/LineChart.tsx`), coloured from
the same theme variables.

The content security policy in `src-tauri/tauri.conf.json` allows only the local app (`'self'`, plus `data:`
images and fonts), Tauri IPC (`ipc:` and `http://ipc.localhost`) and, in development (`devCsp`), the local dev
server at `http://localhost:1420`. There are no remote hosts, frames (`frame-src 'none'`), widgets or remote
assets; every request to Scalable and to GitHub is made by the Rust process.

## How sign-in works

1. The app calls `begin_login` in Rust.
2. Rust discovers the OAuth metadata from Scalable's protected-resource documents. The issuer and every
   endpoint it names must be HTTPS, without credentials, on `scalable.capital` or one of its subdomains;
   anything else is refused before a code or token is sent.
3. It registers a public OAuth client (Dynamic Client Registration) if needed, or reuses the stored
   `client_id`.
4. It opens the authorize URL in your browser with a PKCE challenge and a `state` value.
5. A local TCP listener on port `43127` captures the authorisation code.
6. Rust exchanges the code for an access and a refresh token (client authentication: none).
7. Tokens are refreshed automatically before MCP calls when they are close to expiry.

Your Scalable password never enters the app. The backend keeps one MCP session and reuses it for ten
minutes; it starts a new one after an authorisation error, on sign-out and on "Renew now".

## Trading (buy and sell)

Trading is **off by default**. Turning it on, from any switch or the command palette, asks for
confirmation first; turning it off does not. The top bar switch and the command palette change only the current session; Settings, Trading, **Enable trading at start** is the one saved choice (it also switches Trading on or off right away), and with it on every launch starts with Trading on while the exchange is open. Turn on the "Read-only / Trading on" switch in the top bar (or
Settings, Trading; the switch is on every page except Settings, and all of them show one shared state) to show **Buy** and **Sell** buttons per row and a **New order** button with
security search (on Overview, Portfolio, Watchlist, Discover and Transactions; Groups, Alerts and Savings have
their own "New …" button instead). The same switch shows the buttons that create, change or delete data (watchlist,
price alerts, portfolio groups, savings plans); while it is off they are hidden and Run in Settings,
Scalable tools is disabled. Hiding is a convenience in the UI; the Rust backend also refuses every
non-read tool, including unknown tools, until Trading is on.

- The switch is a backend-enforced **kill switch**, not just a UI preference. The switch itself is not saved: every
  launch, and every reload of the window, starts read-only unless Enable trading at start is on, and the UI tells the backend on every
  change. Signing out also switches it off (in Rust and in the UI) and drops all pending previews, so
  the next sign-in starts read-only too, until the next launch. While it is off, only `ping` and tools whose names start with `get_`, `list_`, `search_` or
  `preview_` may run; every other tool, including unknown future tools, is denied, and a batch that is
  refused as a whole does not even open a session. The order and
  savings-plan dialogs also cannot preview while it is off.
- Trading also counts as off outside the exchange hours of the European Investor Exchange (Monday to
  Friday, 06:00 to 23:00 Berlin time; closed on its holidays, opening at 07:30 on some and closing at
  14:00 on 30 December, see `src-tauri/src/mcp/hours.rs`, mirrored for display in `src/marketHours.ts`).
  The gate checks the clock on every call, the switch cannot be turned on while the exchange is
  closed, and it drops back to Read-only at closing time.
- The submit tools (`submit_buy_order`, `submit_sell_order`, `submit_savings_plan`) can only be sent
  from their own dialogs, which preview first. The backend refuses them from the tool runner too, and
  Run is disabled for them in Settings, Scalable tools.
- Every order has two steps, matching Scalable's own rules: the app calls `preview_buy_order` or
  `preview_sell_order`, shows the preview, and only after you press **Confirm and place order** calls
  `submit_buy_order` or `submit_sell_order`. The preview shows warnings first (product warning,
  price warnings, an outdated quote, a security that cannot be traded, a missing suitability
  questionnaire), then the sections Scalable prepared for display (`reviewPresentation`: order, costs and
  charges), its documents and disclosures, one tick box per required acknowledgement with Scalable's own
  text, and how long the preview stays valid. Confirm stays disabled until every acknowledgement is
  ticked, and when Scalable says the order cannot be placed from here a "Continue in Scalable" link opens
  its own page for it.
- A buy amount is checked against the selected portfolio's buying power in that portfolio's currency;
  a sell by shares cannot exceed the selected security's known holdings in that portfolio. Amounts are
  whole cents of at least 1, and prices take at most 4 decimal places (the finest MiFID II tick; Scalable
  publishes no tick-size table, so its preview has the last word). When the app knows the last price of
  the security (an order opened from a table row), a stop on the market's side of that price is refused,
  because it would trigger at once, and a limit on the market's side gets a hint that it can fill right
  away. Each problem is shown under the field it belongs to, and the field is marked invalid.
- A savings plan works the same way: the form is built from `get_savings_plan_config` (amount limits,
  frequencies, execution days and months, payment methods), `preview_savings_plan` shows Scalable's
  review with the costs, and **Confirm and save plan** calls `submit_savings_plan` with the preview's
  `submission` unchanged. A plan for the same security is updated. Crypto plans are listed only,
  because the removal and change tools take an ISIN.
- Each order or savings-plan flow can hold up to eight pending previews, each identified separately and
  expiring after 5 minutes. Confirmation consumes only the matching preview ID, and the request must still
  be identical to what was previewed. A failed or uncertain submit is never retried automatically.
- Supported: market, limit and stop orders; buy by amount or whole shares; sell by shares.
- **Trading venue.** New orders use the venue selected in Settings, Trading (EIX by default); override it
  in the order form with EIX, Gettex or Xetra. The chosen venue is carried from preview through submit.
  Some securities, such as certain turbos, are not listed at every venue, and Scalable validates the
  selection during preview. Trailing stops always use the account's default venue.
- A failed preview includes Scalable's available error details and a collapsible snapshot of what was sent;
  generic failures suggest checking the venue and security's tradability, or trying again later.
- **Take profit and stop loss (optional).** Scalable has no combined or bracket order, so after a buy is
  submitted the dialog offers **Set take profit** (a limit sell) and **Set stop loss** (a stop sell). Each
  opens the sell form with the security and, when the buy was in whole shares, the share count filled in,
  and then goes through the same preview and confirmation as any other order. Nothing is placed unless you
  choose it. The sell can only be accepted once the bought shares are in your portfolio, and Scalable may
  refuse the second order if the first already reserves the same shares. When the buy was a limit order, the
  take-profit price must be above and the stop-loss price below the limit price.
- **Trailing buy stop (optional, local).** The mirror image, in its own panel on the Trailing stops page: pick any security, an amount of money to spend and a distance above the low. The app follows the lowest ask price and, when the price rises to the low plus the distance, buys at market with `preview_buy_order` and `submit_buy_order`. It has the same rules as the stop loss (app running, signed in, Trading on, never accepts a warning, never repeats a submitted order) and also needs enough cash; an ask more than 25% above the trigger needs manual review. Edit works the same way.
- **Trailing stop loss (optional, local).** Scalable's MCP has no trailing stop, so the app does it itself
  (`extensions/trailing-stops/src-tauri/`: the saved file, quotes, the sale, the watcher and the commands in one file each). Start one on the Trailing stops page (**New trailing stop**) or after a buy
  (**Set trailing stop loss**): pick a security you hold (the dialog shows your shares and a **Sell all** link), the shares to sell and a distance in percent or money, and
  tick that the app may sell without asking again. The app remembers the highest price from then on (the
  bid of `get_security_quote`, else the mid price), checks it every 30 seconds by default (on the Trailing stops page the header Refresh uses this frequency, shows its countdown bar and reads the prices right away; it only runs while a stop is active; the sidebar shows how many stops exist) (Settings, Trailing stops, "Trailing stops check frequency", for both stop losses and buy stops: 15 seconds to 10 minutes; the watcher sleeps while no stop is active, and the page refreshes on a `trailing-stops-changed` event, focus or return to visibility, with a 60-second fallback poll only while visible and a stop is active or selling), and when the price is at
  or below the high minus the distance it sells the shares at market with `preview_sell_order` and
  `submit_sell_order`. **Edit** on a watching row changes its shares and distance (the high is kept; it needs Trading on); on a "Needs you" row it starts watching again from the last price, after you have checked in Scalable that nothing was sold. A thin bar under **Now** shows how much of the distance between the high and the sell price is left. With Trading off the **Now** price still follows the market, but the high is not raised and nothing is sold (the row shows "Paused, Trading is off" and **Stop watching** is disabled until Trading is on). Limits and safeguards:
  - It works only while the app runs (the tray keeps it running), is signed in and **Trading is on**. It is
    not a Scalable order: nothing protects the position while the app is closed, offline or in Read-only mode,
    and a fast drop, a closed market or a price gap can fill well below the trigger.
  - The stops are saved in `trailing_stops.json` in the app config folder (no tokens), but the Trading switch is not
    saved, so after a restart they wait until Trading is on again (automatically with Enable trading at start).
  - It never accepts a warning for you: when the sell preview asks for an acknowledgement or a questionnaire,
    the stop is marked "Needs you" and a notification is shown. An outdated quote or an untradable security
    makes it wait and try again at the next check; a preview price more than 25% below the price that triggered the stop
    needs manual review instead of an automatic sale. A failed preview is retried too.
  - Turning Trading off is the kill switch: no new stop sale is dispatched while it is off. A sale that was submitted is never repeated: if the submit fails or the app stops while selling, the stop
    becomes "Needs you" and you check your transactions. One active stop per security and portfolio.
  - It does not look at what you hold: if the shares are gone or already sold by hand, the sale is refused by
    Scalable and keeps being retried until you remove the stop.
- Order arguments follow the input schemas Scalable publishes. Try a small order first.

## Diagnostics and logging

The app keeps a small log to help with bug reports. It is a JSON-lines file,
`scalable-capital-desktop.log`, in the app log folder (on Windows under
`%LOCALAPPDATA%\com.sk.scalable-capital-desktop\logs`; Settings > Keyboard and about > Diagnostics >
"Open log folder" opens it). It rotates at 1 MB and keeps three files. It records the start-up, the result of
a sign-in, the category of a failed tool call, session set-up, update check or background option, and panics
(message and source location). It never records tool arguments, response bodies, tokens or account data, and
nothing is sent anywhere.

Every log message is redacted first: bearer tokens and authorization headers, `token=`, `secret=` and
`password=` values, JWTs, long hex or base64 runs, URL query strings, fragments and credentials, email
addresses, and the home folder (shown as `~`).

"Copy diagnostics" in the same Settings section copies a text report with the app version, OS and architecture,
the update channel, whether Trading is on (Read-only or enabled), whether you are signed in, the background
options, a count of recent failure categories and the recent redacted log lines. It holds no tokens, account
ids, securities, balances, portfolio names, orders or user paths. Check it before pasting it into an issue.

## Scalable MCP access and known limits

The app is a client of Scalable Capital's MCP server and can only do what Scalable offers to your
sign-in. Scalable publishes the tool names, descriptions and access levels in its help page
[What can my AI Assistant do with the Scalable MCP](https://help.scalable.capital/en/agentic-investing-aac939f8/what-can-my-ai-assistant-do-with-the-scalable-mcp-28d8129c).
It does not publish a stable contract for tool arguments and response shapes, so those can change
without notice.

**Access levels.** You choose one level in your Scalable account. It applies to every connected AI
assistant, app and portfolio. If tools are missing after you change it, sign out and in again here.

| Level | What Scalable allows | What works in this app |
| --- | --- | --- |
| No access | The MCP server cannot be used. | MCP cannot be used; no account data can be loaded through it. |
| Read-only | Reading account, portfolio, market data and similar information. | Portfolio, overview, discover, transactions and other read screens. Watchlist, price alert, group and order actions are missing. |
| Limited access | Read-only plus managing watchlists, price alerts and portfolio groups. | Everything in Read-only plus watchlist, price alert and group actions. Savings-plan and order actions are missing. |
| Full access | Everything, including savings-plan changes and buy and sell orders. | Everything above. Order and savings-plan changes also need the Trading switch. |

What the level allows is decided by Scalable. Settings, Scalable tools always shows the tools your
connection really offers.

**Risk of API changes.** Scalable can rename or remove tools, change argument names or response
shapes, or change access rules. The app is not an official integration.

- In Settings, Scalable tools, a tool the app knows but the connection does not offer shows as "Not
  offered", and an action that needs it explains how to check the access level. A tool Scalable adds
  later, which the app has no feature for, shows as "Not used" and can still be tried with Run.
  Nothing is called blindly.
- Arguments use the property names of each tool's published `inputSchema`; Rust validates tool arguments
  against the current published schema before dispatch. Scalable also publishes an
  output schema per tool, which the Schema window shows, but the app does not keep a copy: response
  field names are matched loosely, so a changed response can show empty cells or a per-tool error
  instead of data. Report the tool name and its raw result (turn on Data diagnostics).
- The unit tests check the arguments the app builds against the input schemas in a saved `tools/list`
  response (`tests/fixtures/mcp-tool-list.json`, used by the tests only and not shipped in the app).
  They cannot detect a change that Scalable has not yet shipped. To compare, open Schema for a tool in
  Settings, Scalable tools; if a schema changed, save a new `tools/list` response over the file and
  update the code that builds those arguments.

**Other known limits**

- The installers are not code-signed unless the maintainer has added certificates (see "Updates and
  signing"). Windows SmartScreen then shows a warning ("More info", "Run anyway") and macOS
  Gatekeeper blocks the first launch (right-click the app and choose Open, or allow it in System
  Settings, Privacy and Security). The update signature protects the updates, not that first install.
- Updates install themselves for the Windows installer (NSIS or MSI), the macOS app and the Linux
  AppImage. The portable Windows exe and the deb and rpm packages get the same notice, but with a link to
  the GitHub release page, and are updated by hand.
- Only the Windows exes were tested by hand. The macOS and Linux builds are released as CI builds them
  and have not been run.
- A failing part of the dashboard (overview, cash, watchlist) is reported with a notice; the rest
  still loads.
- The app has no background trading and no server of its own, and it does not replace the Scalable
  app for anything the MCP server does not expose.
- Savings plans use `preview_savings_plan` and `submit_savings_plan`, which is what the published tool
  list has. The dialog has been tested only against mocked data and unit tests, never a real account.
  If Scalable's preview wants an appropriateness answer that the dialog does not ask for, the preview
  fails with Scalable's message and nothing is saved.
- Not built yet: an in-app editor for fixed-term accounts.

## Development checks

```bash
npm ci                                   # install exactly what package-lock.json pins
npm run typecheck                        # tsc --noEmit
npm run lint                             # ESLint (React hooks and TypeScript rules)
npm run format:check                     # Prettier
npm run check:tauri                      # Tauri npm/Cargo major.minor versions match
npm run check:exports                    # no unused exports in src/
npm test                                 # Vitest: colocated src/*.test.ts(x) and scripts/*.test.mjs
npx vite build                           # production frontend bundle
npm audit --audit-level=high
npm audit signatures
(cd src-tauri && cargo test --offline)   # trading gate, order validation, argument mapping, session cache
(cd src-tauri && cargo fmt --check && cargo clippy --offline --all-targets -- -D warnings)
(cd src-tauri && cargo audit --file Cargo.lock)
(cd src-tauri && cargo deny check)       # licences, duplicate versions, sources (deny.toml)
```

Frontend logic and mocked-invoke UI smoke tests live beside their modules as `*.test.ts` or `*.test.tsx`; Node-side script tests live in `scripts/*.test.mjs`.
Rust unit tests are inline `mod tests` modules next to the code they cover. Use mocked Tauri `invoke` data for
anything that changes data; never call a write tool against a real account when testing.

### Conventions

- Use `onX` for callback props and `handleX` for local event handlers. Prefer `async`/`await` for sequential asynchronous work; `.then()` remains appropriate for promise-returning effects and lazy imports. Name caught errors `error`, and use `type` rather than `interface` for object shapes.
- Build browser-storage keys with `storageKey()` from `src/storage.ts`, and use its safe string/JSON read and write helpers. Keys keep the `scalable-capital-desktop.` prefix; `src/activityCache.ts` is the exception because it reads old keys for the one-time history migration.

If `cargo-audit` or `cargo-deny` is not installed, install it once with `cargo install cargo-audit --locked` or
`cargo install cargo-deny --locked`.

CI runs the frontend checks and Rust checks on Ubuntu and Windows (with `--locked` for Cargo), dependency audits including npm signatures, and installer builds on pushes to `main` and on pull requests. `cargo audit` downloads the RustSec advisory database when it is not already cached.

The Rust crate declares 1.99 as its minimum supported version; `src-tauri/rust-toolchain.toml` pins local work to 1.99.1 with `rustfmt`, `clippy` and the `x86_64-pc-windows-msvc` target (rustup installs them for the pinned toolchain on first use; a target added to another toolchain does not carry over). `src-tauri/rustfmt.toml` fixes the formatting edition to 2021.

Instants are displayed in the machine's local time zone with the short zone name; calendar-only dates remain dates. UTC storage and wire timestamps are not converted or rewritten.

## Building and releases

### Windows build from Linux

This is the local build behind the exes in `release/`. It needs the Windows target for the pinned
toolchain (`src-tauri/rust-toolchain.toml` lists it, so `rustup show` in `src-tauri/` installs it),
`cargo install cargo-xwin --locked` and `apt install nsis lld llvm`. On Linux, `src-tauri/.cargo/config.toml`
links with `clang` and `lld`.

```bash
CI=true npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
T=src-tauri/target/x86_64-pc-windows-msvc/release
cp $T/scalable-capital-desktop.exe release/scalable-capital-desktop-portable.exe
cp $T/bundle/nsis/scalable-capital-desktop_1.0.0_x64-setup.exe release/
```

`release/` is local build output and is not tracked by git. The app needs the WebView2 runtime
(preinstalled on Windows 11). On a Windows machine, `npm run tauri build` also produces an `.msi`.

### CI and tagged releases

| Workflow | Runs on | What it does |
| --- | --- | --- |
| `ci.yml` | pushes to `main`, pull requests | Frontend checks, Rust checks, npm/Cargo dependency audits, then installer builds. |
| `build.yml` | called by the two others | Builds installers on five targets and uploads them as artifacts (14 days). With `sign: true` it also makes the signed updater files (`.sig`). |
| `release.yml` | tags like `v0.1.0` | Checks the tag looks like `vX.Y.Z` and that the updater public key and endpoint are set, writes the tag's version into `tauri.conf.json`, `Cargo.toml` and `package.json` (`scripts/set-version.mjs`), builds every target with signing, and publishes all the installers, their `.sig` files, `SHA256SUMS.txt` and `latest.json` to this repository's GitHub Releases with `scripts/publish-github-release.sh`. The publish job runs in the `release` environment (add a required reviewer there to approve each release) and uses the built-in `GITHUB_TOKEN` with `contents: write`. |

Targets the CI workflows can build: Windows x64 (NSIS installer, MSI and portable exe), macOS Apple
Silicon and Intel (dmg and the `.app.tar.gz` the updater needs), Linux x64 and arm64 (deb, rpm,
AppImage). A release publishes all of them, and only once every target has built: if one fails, re-run
that job and the release goes on. To release a version, tag `vX.Y.Z` and push the tag:
the build takes the version from the tag, so there is nothing to bump by hand (to change the committed
version, run `node scripts/set-version.mjs X.Y.Z`, which updates `package.json`, `src-tauri/Cargo.toml` and
`src-tauri/tauri.conf.json` together). A tag like `vX.Y.Z-rc.N` builds NSIS only on Windows (the MSI cannot carry
a pre-release version) and becomes a GitHub pre-release that you download by hand; installed apps are not offered
it, because GitHub's `latest` never points at a pre-release.

iOS and Android are not built: the token storage uses the `keyring` crate, which has no Android
backend, and the UI is made for a desktop window.

### Updates and signing

Installed apps update from this repository's GitHub Releases. Rust makes the request, not the webview
(`src-tauri/src/updates.rs`), so the capabilities and the CSP stay as they are.

- **What the app does.** On launch (if "Check for updates on launch" is on) `check_for_update` fetches
  the only URL in `plugins.updater.endpoints`:
  `https://github.com/suneetk92/scalable-capital-desktop/releases/latest/download/latest.json`. If it lists a
  newer version, the notice offers **Install and restart**. The install downloads the file for this platform,
  verifies its minisign signature against the public key in `src-tauri/tauri.conf.json`
  (`plugins.updater.pubkey`), installs it and restarts. The host needs no trust: a file that was
  changed fails the signature. A restart starts read-only like every launch, and an install is not
  held back by the Trading switch. A failed check on launch shows nothing. "Open download page" opens the
  GitHub release page.
- **Stable only.** The app offers only the Stable update channel; the Update channel choice is
  hidden. The Rust comparator accepts only strictly newer versions and rejects pre-releases on Stable, so a
  `-rc` release is never offered as an update.
- **Privacy.** The update check is the one request that does not go to Scalable. It sends no account
  data, only what any download sends (such as your IP address). Switch it off in Settings, Keyboard and
  about; the **Check for updates** button still works.
- **Maintainer setup, once.** The public half of the updater key is already in `plugins.updater.pubkey` in
  `src-tauri/tauri.conf.json` (the release fails early if it is empty or a placeholder); the endpoint must
  stay the GitHub Releases `latest.json` URL above. Add the matching private key and its
  password as this repository's GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The private key never goes into the repository, logs or docs. Keep an
  offline backup: without the key no update can be signed, and installed apps would need a manual reinstall.
- **What a release does.** `release.yml` builds with `src-tauri/tauri.updater.conf.json`, which turns on
  `createUpdaterArtifacts`, so each updatable installer gets a `.sig` file. `scripts/publish-github-release.sh`
  then writes `latest.json` with `scripts/make-latest-json.mjs` (it stops the release if the updatable
  installer or `.sig` of any platform is missing: the Windows NSIS and MSI installers, both macOS
  `.app.tar.gz` files and both Linux AppImages), creates the release as a draft with every installer, the
  `.sig` files and `SHA256SUMS.txt`, adds `latest.json` and publishes the draft, so the manifest
  never shows before its files, and finally checks that the public endpoint serves the new version. A stable tag
  becomes the repository's latest release; an `-rc.N` tag is marked a pre-release and gets no manifest.
- **Release notes.** There is no changelog file to keep: the notes are made when a tag is released.
  `scripts/release-notes.mjs vX.Y.Z` lists the commit subjects between the previous release and the tag
  (a stable tag starts at the previous stable tag, so release candidate changes are included; an `-rc.N`
  tag starts at the previous tag of any kind). `feat:` commits become **New**, `fix:` and `perf:`
  commits **Fixed**, and commits without a prefix **Changed**; `chore:`, `ci:`, `build:`, `test:`,
  `docs:`, `style:` and `refactor:` commits, merges and release commits are left out, and a release with
  nothing left says it is a maintenance release. Write commit subjects a user can read. The release uses
  that text as the GitHub release notes and as the `notes` of `latest.json`, so the update notice in the app
  says what changed. It needs the full git history and the tags (the release job fetches them). Preview the
  notes of the next release with `node scripts/release-notes.mjs vX.Y.Z`.
- **Local builds need no key.** The overlay is used only in CI, so the Windows build above works as it
  is. To try the signing locally, generate a throwaway key with `npx tauri signer generate`, set
  `TAURI_SIGNING_PRIVATE_KEY` and its password, and add `--config src-tauri/tauri.updater.conf.json` and
  a `--config` that sets `plugins.updater.pubkey` to the throwaway public key.
- **Key rotation.** Publish a release signed with the old key whose `tauri.conf.json` carries the new
  public key, then switch the secrets to the new key for the releases after it.
- **Code signing (optional).** Windows and macOS certificates cost money and are not required for
  updates. When these secrets exist, the build uses them: `WINDOWS_CERTIFICATE` (a base64 `.pfx`) with
  `WINDOWS_CERTIFICATE_PASSWORD`; and for macOS `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY` and, to notarize, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID`. Without
  them the installers stay unsigned. This path has not been run yet.
- **Not covered.** Portable exe and deb or rpm installs are not updated by the app (see "Other known
  limits"). Test the first release by publishing two tags in a row and updating from the older one.

CI builds the installers for every target on each push to `main`. The release workflow itself (signing,
`latest.json` and publishing) has its first real test with the first tag.

## App icon

The icon is one hand-written vector, `src-tauri/icons/app-icon.svg` (a rising teal line on a dark
rounded tile). The window, taskbar and installer use the generated formats, and the sidebar logo
(`src/Brand.tsx`) draws the same glyph inline. To change it, edit the SVG, then regenerate every platform
format and remove the mobile folders the command also creates:

```bash
npx tauri icon src-tauri/icons/app-icon.svg
rm -rf src-tauri/icons/android src-tauri/icons/ios
```

## More documents

- [`AGENTS.md`](AGENTS.md): rules for coding agents working in this repository.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): development checks, test layout and contribution conventions.

## License

Copyright 2026 Suneet Kumar. Licensed under the [Apache License 2.0](LICENSE). The [NOTICE](NOTICE)
file credits the author; keep it when you redistribute or modify the code. Not affiliated with
Scalable Capital.
