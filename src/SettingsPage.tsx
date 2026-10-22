import { Description, Field, Input, Label, Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { ArrowPathIcon, BellAlertIcon, ClockIcon, InformationCircleIcon, PaintBrushIcon, ShieldCheckIcon, WrenchScrewdriverIcon } from "@heroicons/react/24/outline";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState, type ReactNode } from "react";
import { clearHistories, storedCount } from "./activityCache";
import { ALERT_MINUTE_OPTIONS } from "./alerts";
import { invoke } from "./app/invoke";
import { invokeCommand } from "./commands";
import { Select } from "./controls";
import { extension } from "./extensions";
import type { useBackground } from "./hooks/useBackground";
import type { useUpdater } from "./hooks/useUpdater";
import type { View } from "./nav";
import { ToolsPage } from "./pages/Tools";
import { SessionPanel, type SessionState } from "./SessionPanel";
import type { Common } from "./types";
import { isReinstall, statusMessage } from "./updates";
import { formatNumber, pluralize } from "./format";
import { Alert, btn, cx, PANEL, Pills, PREVIEW_TABLE, SecurityCell, Switch } from "./ui";
import {
  DEFAULT_SETTINGS,
  FONT_FAMILIES,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  PAGE_SIZE_OPTIONS,
  REFRESH_OPTIONS,
  VENUE_OPTIONS,
  type DensitySetting,
  type FontFamilySetting,
  type Settings,
  type ThemeSetting,
  type UpdateChannelSetting,
  type VenueSetting,
} from "./settings";

type Props = {
  settings: Settings;
  tradingEnabled: boolean;
  marketOpen: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onToggleTrading: () => void;
  onReset: () => void;
  session: SessionState;
  common: Common;
  /** The raw Scalable data as text; empty unless Data diagnostics is on. */
  diagnostics: string;
  onCopyText: (text: string, done: string) => void;
  onCopyToken: () => void;
  onSignOut: () => void;
  onSelectView: (view: View) => void;
  updater: ReturnType<typeof useUpdater>;
  background: ReturnType<typeof useBackground>;
  extensionSection?: ReactNode;
};

const THEMES: [ThemeSetting, string][] = [
  ["dark", "Dark"],
  ["light", "Light"],
  ["system", "System"],
];
const DENSITIES: [DensitySetting, string][] = [
  ["comfortable", "Comfortable"],
  ["compact", "Compact"],
];
const UPDATE_CHANNELS: [UpdateChannelSetting, string][] = [
  ["stable", "Stable"],
  ["rc", "Release candidate"],
];

const SHORTCUTS: [string, string][] = [
  ["Ctrl+K or Alt+K", "Focus the table search"],
  ["Ctrl+P", "Open the command palette"],
  ["Ctrl+,", "Open these settings"],
  ["Alt+↑ or Alt+↓", "Move the focused sidebar item"],
  ["Esc", "Close the open menu, dialog or panel"],
];

const SECTIONS = [
  { id: "appearance", label: "Appearance", icon: PaintBrushIcon },
  { id: "data", label: "Data and refresh", icon: ArrowPathIcon },
  { id: "background", label: "Background", icon: BellAlertIcon },
  { id: "session", label: "Session", icon: ClockIcon },
  { id: "trading", label: "Trading", icon: ShieldCheckIcon },
  { id: "tools", label: "Scalable tools", icon: WrenchScrewdriverIcon },
  { id: "about", label: "Keyboard and about", icon: InformationCircleIcon },
] as const;

/** One labelled setting: label and hint on the left, the control on the right (Headless UI Field wires the label). */
function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <Field className="flex items-center justify-between gap-4 border-b border-line py-3.5 last:border-b-0 max-[640px]:flex-col max-[640px]:items-start">
      <div className="grid min-w-0 gap-0.5">
        <Label className="text-ink-strong">{label}</Label>
        {hint && <Description className="text-ink-muted">{hint}</Description>}
      </div>
      {children}
    </Field>
  );
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={PANEL}>
      <h2 className="border-b border-line px-[1.2rem] py-3 text-section font-semibold tracking-tight text-ink-strong">{title}</h2>
      <div className="px-[1.2rem]">{children}</div>
    </section>
  );
}

function useAppVersion() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((value) => {
        if (active) setVersion(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return version;
}

function errorMessage(error: unknown, fallback: string) {
  return typeof error === "string" ? error : error instanceof Error ? error.message : fallback;
}

/** Copies the sanitised bug-report text built in Rust (`diagnostics.rs`) and opens the log folder; no path or data passes through the webview. */
function DiagnosticsCard({ updateChannel, onCopyText }: { updateChannel: UpdateChannelSetting; onCopyText: (text: string, done: string) => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  async function copy() {
    try {
      const text = await invokeCommand(invoke, "export_diagnostics", { updateChannel });
      setProblem(null);
      onCopyText(text, "Diagnostics copied to the clipboard.");
    } catch (error) {
      setProblem(errorMessage(error, "The diagnostics could not be created."));
    }
  }
  async function openFolder() {
    try {
      await invokeCommand(invoke, "open_log_folder");
      setProblem(null);
    } catch (error) {
      setProblem(errorMessage(error, "The log folder could not be opened."));
    }
  }
  return (
    <SectionCard title="Diagnostics">
      <Row
        label="Copy diagnostics"
        hint="Copies a report for bug reports: app version, system, update channel, whether Trading is on and whether you are signed in, background options and the recent log lines. Tokens, account details, securities, balances, orders and file paths are never included"
      >
        <button className={btn.secondary} type="button" onClick={() => void copy()}>
          Copy diagnostics
        </button>
      </Row>
      <Row label="Log folder" hint="The app writes a small log of start-ups, sign-in results and failure categories, never data or tokens. The three newest files of up to 1 MB are kept">
        <button className={btn.secondary} type="button" onClick={() => void openFolder()}>
          Open log folder
        </button>
      </Row>
      {problem && <Alert onDismiss={() => setProblem(null)}>{problem}</Alert>}
    </SectionCard>
  );
}

function refreshOptions(current: number) {
  return [
    ...(REFRESH_OPTIONS.some(([seconds]) => seconds === current) ? [] : [{ value: current, label: `${current} seconds` }]),
    ...REFRESH_OPTIONS.map(([seconds, text]) => ({ value: seconds, label: text })),
  ];
}

const PANEL_NARROW = "grid gap-4 focus:outline-none";

export function SettingsPage({
  settings,
  tradingEnabled,
  marketOpen,
  onChange,
  onToggleTrading,
  onReset,
  session,
  common,
  diagnostics,
  onCopyText,
  onCopyToken,
  onSignOut,
  onSelectView,
  updater,
  background,
  extensionSection,
}: Props) {
  const version = useAppVersion();
  const [stored, setStored] = useState(() => storedCount());
  return (
    <TabGroup className="flex items-start gap-6 max-[900px]:flex-col max-[900px]:gap-4">
      <TabList className="flex w-56 shrink-0 flex-col gap-1 max-[900px]:w-full max-[900px]:flex-row max-[900px]:flex-wrap">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <Tab
            key={id}
            className="flex cursor-pointer items-center gap-2.5 rounded-control px-3 py-2 text-left text-ink-soft hover:bg-raised hover:text-ink-strong data-focus:outline-2 data-focus:outline-accent data-selected:bg-hover data-selected:text-ink-heading"
          >
            <Icon aria-hidden="true" className="size-5 shrink-0" />
            {label}
          </Tab>
        ))}
        <button className={cx(btn.secondary, "mt-3 max-[900px]:mt-0")} type="button" onClick={onReset} disabled={JSON.stringify(settings) === JSON.stringify(DEFAULT_SETTINGS)}>
          Reset to defaults
        </button>
      </TabList>

      <TabPanels className="min-w-0 flex-1">
        <TabPanel className={PANEL_NARROW}>
          <SectionCard title="Appearance">
            <Row label="Theme" hint="Applies to the whole app">
              <Pills label="Theme" value={settings.theme} options={THEMES} onSelect={(theme) => onChange({ theme })} />
            </Row>
            <Row label="Font size" hint={`${settings.fontSize}px`}>
              <div className="flex items-center gap-2">
                <button
                  className={btn.secondary}
                  type="button"
                  aria-label="Decrease font size"
                  disabled={settings.fontSize <= FONT_SIZE_MIN}
                  onClick={() => onChange({ fontSize: settings.fontSize - 1 })}
                >
                  A−
                </button>
                <Input
                  type="range"
                  className="w-40 accent-accent"
                  min={FONT_SIZE_MIN}
                  max={FONT_SIZE_MAX}
                  step={1}
                  value={settings.fontSize}
                  onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
                />
                <button
                  className={btn.secondary}
                  type="button"
                  aria-label="Increase font size"
                  disabled={settings.fontSize >= FONT_SIZE_MAX}
                  onClick={() => onChange({ fontSize: settings.fontSize + 1 })}
                >
                  A+
                </button>
              </div>
            </Row>
            <Row label="Font">
              <Select
                size="compact"
                value={settings.fontFamily}
                onChange={(fontFamily: FontFamilySetting) => onChange({ fontFamily })}
                options={(Object.keys(FONT_FAMILIES) as FontFamilySetting[]).map((key) => ({ value: key, label: FONT_FAMILIES[key].label }))}
              />
            </Row>
            <Row label="Table density" hint="Row height in the tables">
              <Pills label="Table density" value={settings.density} options={DENSITIES} onSelect={(density) => onChange({ density })} />
            </Row>
            <div className="mb-4 overflow-x-auto rounded-panel border border-dashed border-line-strong bg-inset text-ink-body" aria-label="Preview">
              <table className={`${PREVIEW_TABLE} [&_thead]:bg-transparent`}>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th className="text-right">Price</th>
                    <th className="text-right">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["RHM", "Rheinmetall", "961.60", "+0.14%"],
                    ["SHOP", "Shopify A", "159.88", "-0.83%"],
                    ["BYD", "BYD Co H", "8.40", "-1.75%"],
                  ].map(([symbol, name, price, change]) => (
                    <tr key={symbol}>
                      <td>
                        <SecurityCell initials={symbol[0]} title={symbol} subtitle={name} />
                      </td>
                      <td className="text-right">{price}</td>
                      <td className="text-right">{change}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </TabPanel>

        <TabPanel className={PANEL_NARROW}>
          <SectionCard title="Data and refresh">
            <Row label="Scalable auto-refresh" hint="Reloads your account data (portfolio, watchlist, cash, other pages). Pauses while the window is hidden or an order is open">
              <Switch label="Auto-refresh" checked={settings.autoRefresh} onToggle={() => onChange({ autoRefresh: !settings.autoRefresh })} />
            </Row>
            <Row label="Scalable refresh frequency">
              <Select
                size="compact"
                value={settings.refreshSeconds}
                disabled={!settings.autoRefresh}
                onChange={(refreshSeconds: number) => onChange({ refreshSeconds })}
                options={refreshOptions(settings.refreshSeconds)}
              />
            </Row>
            {extensionSection}
            <Row label="Rows per page" hint="Long tables (portfolio, watchlist, transactions, price alerts, savings plans, Scalable tools) are split into pages">
              <Select size="compact" value={settings.pageSize} onChange={(pageSize: number) => onChange({ pageSize })} options={PAGE_SIZE_OPTIONS.map(([value, label]) => ({ value, label }))} />
            </Row>
            <Row
              label="Stored transactions"
              hint={`Past transactions do not change, so the Overview keeps them on this computer and fetches only what is new since. Clear them if a figure looks wrong; the next Overview visit then reads everything again. ${stored > 0 ? `${formatNumber(stored, 0)} stored now.` : "Nothing is stored now."}`}
            >
              <button
                className={btn.secondary}
                type="button"
                disabled={stored === 0}
                onClick={() => {
                  clearHistories();
                  setStored(storedCount());
                }}
              >
                Clear stored transactions
              </button>
            </Row>
            <Row label="Data diagnostics" hint="Shows the raw Scalable data below, the “Raw data” sections (tool results, security details, order preview) and the access-token copy button in Session">
              <Switch label="Data diagnostics" checked={settings.showDiagnostics} onToggle={() => onChange({ showDiagnostics: !settings.showDiagnostics })} />
            </Row>
          </SectionCard>
          {settings.showDiagnostics && (
            <SectionCard title="Raw data">
              <p className="py-3.5 text-ink-muted">Full raw data from Scalable, and what the app read from it.</p>
              <button className={btn.secondary} type="button" onClick={() => onCopyText(diagnostics, "Raw data copied to the clipboard.")}>
                Copy raw data
              </button>
              <pre className="my-4 max-h-96 overflow-auto rounded-control bg-inset p-3 break-words whitespace-pre-wrap select-text">{diagnostics}</pre>
            </SectionCard>
          )}
        </TabPanel>

        <TabPanel className={PANEL_NARROW}>
          {background.status && (
            <SectionCard title="Running in the background">
              <Row
                label="Close to the tray"
                hint="The close button hides the window and the app keeps running in the Windows notification area, so price alerts keep coming. Click the tray icon to open the window again; use Quit in its menu to exit. Off makes the close button quit the app"
              >
                <Switch label="Close to the tray" checked={background.status.closeToTray} onToggle={() => void background.update({ closeToTray: !background.status!.closeToTray })} />
              </Row>
              <Row label="Start with Windows" hint="Opens the app when you sign in to Windows. You still sign in to Scalable again when the saved session has expired">
                <Switch label="Start with Windows" checked={background.status.launchAtStartup} onToggle={() => void background.update({ launchAtStartup: !background.status!.launchAtStartup })} />
              </Row>
              <Row label="Start in the tray" hint="A start with Windows opens no window and waits in the tray. Starting the app yourself always opens the window">
                <Switch
                  label="Start in the tray"
                  checked={background.status.startMinimized}
                  disabled={!background.status.launchAtStartup}
                  onToggle={() => void background.update({ startMinimized: !background.status!.startMinimized })}
                />
              </Row>
              <Row label="Test notification" hint="Sends a Windows notification now. If nothing appears, check that Windows notifications and Focus assist allow Scalable Capital Desktop">
                <button className={btn.secondary} type="button" onClick={() => void background.sendTest()}>
                  Send test notification
                </button>
              </Row>
            </SectionCard>
          )}
          <SectionCard title="Price alert notices">
            <Row
              label="Price alert notices"
              hint="Checks Scalable every few minutes and tells you when a price alert has fired, as a Windows notification and in the bell list. Works only while the app runs (also in the tray) and you are signed in; Scalable's own push message to your phone is not affected"
            >
              <Switch label="Price alert notices" checked={settings.alertWatch} onToggle={() => onChange({ alertWatch: !settings.alertWatch })} />
            </Row>
            <Row label="Alert check frequency">
              <Select
                size="compact"
                value={settings.alertMinutes}
                disabled={!settings.alertWatch}
                onChange={(alertMinutes: number) => onChange({ alertMinutes })}
                options={ALERT_MINUTE_OPTIONS.map((minutes) => ({ value: minutes, label: pluralize(minutes, "minute") }))}
              />
            </Row>
            <Row
              label="Also show in the app"
              hint="Notices (fired alerts, results, errors) are Windows notifications. On adds a pop-up at the bottom right of the window too. Off shows the pop-up only when Windows cannot show the notification; the bell list always records every notice"
            >
              <Switch label="Also show in the app" checked={settings.alertToasts} onToggle={() => onChange({ alertToasts: !settings.alertToasts })} />
            </Row>
          </SectionCard>
          <SectionCard title="Trailing stop losses">
            <Row
              label="Trailing stop check frequency"
              hint="How often the app reads the price of each security with a trailing stop. Shorter reacts faster to a drop but makes more requests to Scalable, which may throttle them. Checks run only while the app runs, you are signed in and Trading is on"
            >
              <Select
                size="compact"
                value={settings.trailingSeconds}
                onChange={(trailingSeconds: number) => onChange({ trailingSeconds })}
                options={REFRESH_OPTIONS.map(([seconds, text]) => ({ value: seconds, label: text }))}
              />
            </Row>
          </SectionCard>
        </TabPanel>

        <TabPanel className={PANEL_NARROW}>
          <SectionCard title="Session">
            <SessionPanel session={session} showDiagnostics={settings.showDiagnostics} onCopyToken={onCopyToken} onSignOut={onSignOut} />
          </SectionCard>
        </TabPanel>

        <TabPanel className={PANEL_NARROW}>
          <SectionCard title="Trading">
            <Row label="Default trading venue" hint="New orders start with this venue; you can still change it in each order.">
              <Select size="compact" value={settings.orderVenue} onChange={(orderVenue: VenueSetting) => onChange({ orderVenue })} options={VENUE_OPTIONS} />
            </Row>
            <Row
              label="Enable trading"
              hint={`Off keeps the app read-only: only ping and get, list, search or preview tools can run; every other tool is blocked, including unknown tools. It is never saved: the app starts read-only every time. Orders and savings plans also need the Full MCP access level. Trading also stays off outside the exchange hours (Monday to Friday, 06:00 to 23:00 Berlin time, with some holidays closed or shortened)${marketOpen ? "" : ": the exchange is closed now"}.`}
            >
              <Switch label="Enable trading" checked={tradingEnabled} onToggle={onToggleTrading} />
            </Row>
          </SectionCard>
        </TabPanel>

        <TabPanel className="min-w-0 focus:outline-none">
          <p className="mb-3 text-ink-muted">Every Scalable MCP tool this connection offers, and where the app uses it.</p>
          <ToolsPage common={common} onSelectView={onSelectView} />
        </TabPanel>

        <TabPanel className={PANEL_NARROW}>
          <SectionCard title="Keyboard shortcuts">
            <dl className="divide-y divide-line">
              {SHORTCUTS.map(([keys, text]) => (
                <div key={keys} className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-ink-body">{text}</dt>
                  <dd>
                    <kbd className="rounded border border-line-strong bg-raised px-1.5 py-0.5 text-ink-strong whitespace-pre">{keys}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </SectionCard>
          <SectionCard title="About">
            <Row label="Check for updates" hint={statusMessage(updater.state) || "Looks for a newer signed version"}>
              <div className="flex shrink-0 items-center gap-2">
                {updater.state.status === "available" && updater.state.info.canInstall && (
                  <button className={btn.primary} type="button" onClick={() => void updater.install()}>
                    {isReinstall(updater.state.info) ? "Reinstall and restart" : "Install and restart"}
                  </button>
                )}
                {updater.state.status === "available" && !updater.state.info.canInstall && updater.state.info.releaseUrl && (
                  <button className={btn.secondary} type="button" onClick={updater.openReleasePage}>
                    Open download page
                  </button>
                )}
                <button className={btn.secondary} type="button" onClick={() => void updater.check()} disabled={updater.state.status === "checking" || updater.state.status === "downloading"}>
                  Check for updates
                </button>
                <button
                  className={btn.secondary}
                  type="button"
                  onClick={() => void updater.reinstall()}
                  disabled={updater.state.status === "checking" || updater.state.status === "downloading"}
                  title="Downloads the current release again and installs it over this one, for example to repair a broken install"
                >
                  Reinstall
                </button>
              </div>
            </Row>
            {extension.id !== "none" && (
              <Row
                label="Update channel"
                hint="Stable gets tested releases only. Release candidate also offers early -rc versions, which may still have bugs. Switching does not downgrade an installed version"
              >
                <Pills label="Update channel" value={settings.updateChannel} options={UPDATE_CHANNELS} onSelect={(updateChannel) => onChange({ updateChannel })} />
              </Row>
            )}
            <Row
              label="Check for updates on launch"
              hint="Asks the update server once when the app starts whether a newer version exists. It sends no account data, only what any download request sends, such as your IP address. Installing always asks you first"
            >
              <Switch label="Check for updates on launch" checked={settings.checkUpdates} onToggle={() => onChange({ checkUpdates: !settings.checkUpdates })} />
            </Row>
            <dl className="divide-y divide-line">
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-ink-soft">App</dt>
                <dd className="text-ink-strong">
                  Scalable Capital Desktop{extension.variantName ? ` ${extension.variantName}` : ""}
                  {version ? ` ${version}` : ""}
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-ink-soft">Author</dt>
                <dd className="text-ink-strong">Suneet Kumar</dd>
              </div>
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-ink-soft">License</dt>
                <dd className="text-ink-strong">Apache-2.0</dd>
              </div>
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-ink-soft">Data source</dt>
                <dd className="text-ink-strong">Scalable Capital MCP</dd>
              </div>
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-ink-soft">Affiliation</dt>
                <dd className="text-right text-ink-strong">Independent project, not affiliated with or endorsed by Scalable Capital</dd>
              </div>
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-ink-soft">Stored on this computer</dt>
                <dd className="text-right text-ink-strong">Settings and sidebar order (local storage), sign-in token (system keychain)</dd>
              </div>
            </dl>
          </SectionCard>
          {isTauri() && <DiagnosticsCard updateChannel={settings.updateChannel} onCopyText={onCopyText} />}
        </TabPanel>
      </TabPanels>
    </TabGroup>
  );
}
