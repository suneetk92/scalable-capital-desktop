import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ALERT_MINUTE_OPTIONS } from "./alerts";
import { DEFAULT_COLUMNS, sanitizeColumns } from "./marketColumns";
import { readStored, writeStored } from "./storage";
import { extension } from "./extensions";

export type ThemeSetting = "dark" | "light" | "system";
export type FontFamilySetting = "inter" | "system" | "segoe" | "serif" | "mono";
export type DensitySetting = "comfortable" | "compact";
/** Which releases the update check offers: stable ones only, or release candidates (`-rc` versions) as well. */
export type UpdateChannelSetting = "stable" | "rc";
export type VenueSetting = "eix" | "gettex" | "xetra";

export const VENUE_OPTIONS: { value: VenueSetting; label: string }[] = [
  { value: "eix", label: "EIX" },
  { value: "gettex", label: "Gettex" },
  { value: "xetra", label: "Xetra" },
];

export type Settings = {
  theme: ThemeSetting;
  fontSize: number;
  fontFamily: FontFamilySetting;
  density: DensitySetting;
  autoRefresh: boolean;
  refreshSeconds: number;
  /** Rows per table page; 0 shows every row. */
  pageSize: number;
  /** Shows the raw-data views (Settings → Raw data, tool results, security details, order preview) and the access-token copy button. */
  showDiagnostics: boolean;
  /** Column ids of the Portfolio and Watchlist tables, after the symbol, in the order shown. */
  tableColumns: string[];
  /** Checks Scalable for fired price alerts while the app runs and announces them. */
  alertWatch: boolean;
  /** Minutes between two alert checks. */
  alertMinutes: number;
  /** Also pops up an in-app toast for every notice; off leaves the Windows notification and the notification center. */
  alertToasts: boolean;
  /** Seconds between two price checks of the trailing stops, which the Rust backend runs. */
  trailingSeconds: number;
  /** Asks the update server once at launch whether a newer version exists. The only request that does not go to Scalable. */
  checkUpdates: boolean;
  updateChannel: UpdateChannelSetting;
  /** Venue preselected for new orders. */
  orderVenue: VenueSetting;
  /** Starts every launch with Trading on. Only the Settings switch changes it; the other Trading switches affect the current session only. */
  tradingAtStart: boolean;
};

/** Saved with the settings; raise it and add a step to `SETTINGS_MIGRATIONS` when a saved field changes meaning. */
export const SETTINGS_VERSION = 1;

export const FONT_SIZE_MIN = 11;
export const FONT_SIZE_MAX = 22;

export const REFRESH_OPTIONS: [number, string][] = [
  [15, "15 seconds"],
  [30, "30 seconds"],
  [60, "1 minute"],
  [120, "2 minutes"],
  [300, "5 minutes"],
  [600, "10 minutes"],
];

/** "30 seconds", "1 minute" becomes "minute"; used in "every …". */
export const intervalLabel = (seconds: number) => (REFRESH_OPTIONS.find(([value]) => value === seconds)?.[1] ?? `${seconds} seconds`).replace(/^1 /, "");

export const PAGE_SIZE_OPTIONS: [number, string][] = [
  [10, "10 rows"],
  [25, "25 rows"],
  [50, "50 rows"],
  [100, "100 rows"],
  [200, "200 rows"],
  [0, "All rows"],
];

export const FONT_FAMILIES: Record<FontFamilySetting, { label: string; css: string }> = {
  inter: { label: "Inter", css: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  system: { label: "System default", css: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  segoe: { label: "Segoe UI / Arial", css: '"Segoe UI", Arial, Helvetica, sans-serif' },
  serif: { label: "Serif", css: 'Georgia, "Times New Roman", serif' },
  mono: { label: "Monospace", css: 'ui-monospace, "Cascadia Mono", Consolas, "SFMono-Regular", Menlo, monospace' },
};

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  fontSize: 15,
  fontFamily: "inter",
  density: "comfortable",
  autoRefresh: false,
  refreshSeconds: 60,
  pageSize: 10,
  showDiagnostics: false,
  tableColumns: [...new Set([...DEFAULT_COLUMNS, ...(extension.tableColumns?.defaults ?? [])])],
  alertWatch: true,
  alertMinutes: 5,
  alertToasts: false,
  trailingSeconds: 30,
  checkUpdates: true,
  updateChannel: "stable",
  orderVenue: "eix",
  tradingAtStart: false,
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function refreshInterval(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(3600, Math.max(15, Math.round(value))) : fallback;
}

export function sanitizeSettings(raw: Partial<Record<keyof Settings, unknown>>): Settings {
  return {
    theme: oneOf(raw.theme, ["dark", "light", "system"], DEFAULT_SETTINGS.theme),
    fontSize: clamp(raw.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX, DEFAULT_SETTINGS.fontSize),
    fontFamily: oneOf(raw.fontFamily, Object.keys(FONT_FAMILIES) as FontFamilySetting[], DEFAULT_SETTINGS.fontFamily),
    density: oneOf(raw.density, ["comfortable", "compact"], DEFAULT_SETTINGS.density),
    autoRefresh: typeof raw.autoRefresh === "boolean" ? raw.autoRefresh : DEFAULT_SETTINGS.autoRefresh,
    refreshSeconds: refreshInterval(raw.refreshSeconds, DEFAULT_SETTINGS.refreshSeconds),
    pageSize: typeof raw.pageSize === "number" && PAGE_SIZE_OPTIONS.some(([size]) => size === raw.pageSize) ? raw.pageSize : DEFAULT_SETTINGS.pageSize,
    showDiagnostics: typeof raw.showDiagnostics === "boolean" ? raw.showDiagnostics : DEFAULT_SETTINGS.showDiagnostics,
    tableColumns: Array.isArray(raw.tableColumns) ? sanitizeColumns(raw.tableColumns) : [...DEFAULT_SETTINGS.tableColumns],
    alertWatch: typeof raw.alertWatch === "boolean" ? raw.alertWatch : DEFAULT_SETTINGS.alertWatch,
    alertMinutes: ALERT_MINUTE_OPTIONS.find((minutes) => minutes === raw.alertMinutes) ?? DEFAULT_SETTINGS.alertMinutes,
    alertToasts: typeof raw.alertToasts === "boolean" ? raw.alertToasts : DEFAULT_SETTINGS.alertToasts,
    trailingSeconds: REFRESH_OPTIONS.find(([seconds]) => seconds === raw.trailingSeconds)?.[0] ?? DEFAULT_SETTINGS.trailingSeconds,
    checkUpdates: typeof raw.checkUpdates === "boolean" ? raw.checkUpdates : DEFAULT_SETTINGS.checkUpdates,
    updateChannel: oneOf(raw.updateChannel, ["stable", "rc"], DEFAULT_SETTINGS.updateChannel),
    orderVenue: oneOf(raw.orderVenue, ["eix", "gettex", "xetra"], DEFAULT_SETTINGS.orderVenue),
    tradingAtStart: typeof raw.tradingAtStart === "boolean" ? raw.tradingAtStart : DEFAULT_SETTINGS.tradingAtStart,
  };
}

type StoredSettings = Record<string, unknown>;
let preservedSettings: StoredSettings = {};

/**
 * One step per saved version, from that version to the next. Each step renames or converts fields
 * only; `sanitizeSettings` still checks every value afterwards. Version 0 is the unversioned
 * format of the first releases, which has the same fields as version 1.
 */
const SETTINGS_MIGRATIONS: Record<number, (raw: StoredSettings) => StoredSettings> = {
  0: (raw) => raw,
};

/** The version a stored value claims; missing or unreadable counts as 0. */
function storedVersion(raw: StoredSettings): number {
  return typeof raw.version === "number" && Number.isInteger(raw.version) && raw.version >= 0 ? raw.version : 0;
}

/** Brings a stored value up to `SETTINGS_VERSION` and strips the version field; newer values are passed through for `sanitizeSettings` to prune. */
export function migrateSettings(raw: StoredSettings): StoredSettings {
  let current = raw;
  for (let version = storedVersion(raw); version < SETTINGS_VERSION; version += 1) {
    current = SETTINGS_MIGRATIONS[version]?.(current) ?? current;
  }
  const { version: _version, ...rest } = current;
  return rest;
}

/** The value written to storage: the settings with their schema version. */
export function serializeSettings(settings: Settings): string {
  return JSON.stringify({ version: SETTINGS_VERSION, ...preservedSettings, ...settings });
}

/** Settings from a stored value, or `null` when it is not an object (the caller keeps it aside). */
export function parseStoredSettings(stored: string): Settings | null {
  const raw: unknown = JSON.parse(stored);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const legacy = raw as StoredSettings;
  extension.migrateLegacy?.(legacy);
  preservedSettings = Object.fromEntries(Object.entries(legacy).filter(([key]) => key !== "version" && !(key in DEFAULT_SETTINGS)));
  return sanitizeSettings(migrateSettings(legacy));
}

export function loadSettings(): Settings {
  const stored = readStored("settings");
  if (!stored) {
    preservedSettings = {};
    return DEFAULT_SETTINGS;
  }
  try {
    const settings = parseStoredSettings(stored);
    if (settings) return settings;
  } catch {
    // Malformed settings are kept aside below.
  }
  // Keep what was there so it can be looked at, instead of silently replacing it on the next save.
  writeStored("settings.bad", stored);
  return DEFAULT_SETTINGS;
}

function systemPrefersLight() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches;
}

/** Whether the theme setting shows the light theme right now ("system" follows the OS). */
function isLightTheme(theme: ThemeSetting) {
  return theme === "light" || (theme === "system" && systemPrefersLight());
}

function subscribeSystemTheme(listener: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia("(prefers-color-scheme: light)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** Like `isLightTheme`, but re-renders when the OS theme changes while the setting is "system". */
export function useLightTheme(theme: ThemeSetting) {
  const system = useSyncExternalStore(subscribeSystemTheme, systemPrefersLight);
  return theme === "light" || (theme === "system" && system);
}

export function applySettings(settings: Settings) {
  const root = document.documentElement;
  const light = isLightTheme(settings.theme);
  root.dataset.theme = light ? "light" : "dark";
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", light ? "#f3f4f8" : "#101217");
  root.dataset.density = settings.density;
  root.style.setProperty("--app-font-size", `${settings.fontSize}px`);
  root.style.setProperty("--app-font-family", FONT_FAMILIES[settings.fontFamily].css);
}

let diagnosticsVisible = loadSettings().showDiagnostics;
const diagnosticsListeners = new Set<() => void>();

function publishDiagnostics(value: boolean) {
  if (value === diagnosticsVisible) return;
  diagnosticsVisible = value;
  diagnosticsListeners.forEach((listener) => listener());
}

/** True when the "Data diagnostics" setting is on; gates every raw-data view in the app. */
export function useShowDiagnostics() {
  return useSyncExternalStore(
    (listener) => {
      diagnosticsListeners.add(listener);
      return () => diagnosticsListeners.delete(listener);
    },
    () => diagnosticsVisible,
  );
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  useEffect(() => {
    applySettings(settings);
    publishDiagnostics(settings.showDiagnostics);
    writeStored("settings", serializeSettings(settings));
  }, [settings]);

  useEffect(() => {
    if (settings.theme !== "system" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applySettings(settings);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => sanitizeSettings({ ...current, ...patch }));
  }, []);
  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  return { settings, update, reset };
}
