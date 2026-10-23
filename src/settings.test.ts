import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SETTINGS, FONT_SIZE_MAX, FONT_SIZE_MIN, loadSettings, migrateSettings, parseStoredSettings, sanitizeSettings, serializeSettings, SETTINGS_VERSION } from "./settings";
import { storageKey } from "./storage";

describe("settings schema version", () => {
  it("saves the version with the settings and reads it back", () => {
    const stored = serializeSettings({ ...DEFAULT_SETTINGS, theme: "light" });
    expect(JSON.parse(stored).version).toBe(SETTINGS_VERSION);
    expect(parseStoredSettings(stored)).toEqual({ ...DEFAULT_SETTINGS, theme: "light" });
  });

  it("reads the unversioned format of the first releases", () => {
    expect(parseStoredSettings(JSON.stringify({ theme: "light", pageSize: 25 }))).toEqual({ ...DEFAULT_SETTINGS, theme: "light", pageSize: 25 });
    expect(migrateSettings({ theme: "light" })).toEqual({ theme: "light" });
  });

  it("strips the version field and tolerates a newer or odd version", () => {
    expect(migrateSettings({ version: SETTINGS_VERSION, theme: "light" })).toEqual({ theme: "light" });
    expect(parseStoredSettings(JSON.stringify({ version: SETTINGS_VERSION + 5, theme: "light", future: 1 }))).toEqual({ ...DEFAULT_SETTINGS, theme: "light" });
    expect(parseStoredSettings(JSON.stringify({ version: "x", theme: "light" }))).toEqual({ ...DEFAULT_SETTINGS, theme: "light" });
  });

  it("rejects values that are not an object so they can be kept aside", () => {
    expect(parseStoredSettings("null")).toBeNull();
    expect(parseStoredSettings("[1]")).toBeNull();
    expect(() => parseStoredSettings("{not json")).toThrow();
  });
});

describe("sanitizeSettings", () => {
  it("returns the defaults for empty or garbage input", () => {
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(
      sanitizeSettings({
        theme: "neon",
        fontSize: "big",
        fontFamily: 3,
        density: null,
        autoRefresh: "yes",
        refreshSeconds: NaN,
        pageSize: 7,
        showDiagnostics: 1,
        tableColumns: "price",
        alertWatch: "yes",
        alertMinutes: 7,
        alertToasts: "yes",
        checkUpdates: "yes",
        updateChannel: "nightly",
        orderVenue: "nasdaq",
      }),
    ).toEqual(DEFAULT_SETTINGS);
  });

  it("shows 10 rows per page by default", () => {
    expect(DEFAULT_SETTINGS.pageSize).toBe(10);
    expect(sanitizeSettings({ pageSize: 10 }).pageSize).toBe(10);
  });

  it("keeps valid values", () => {
    const valid = {
      theme: "light",
      fontSize: 18,
      fontFamily: "mono",
      density: "compact",
      autoRefresh: true,
      refreshSeconds: 120,
      pageSize: 0,
      showDiagnostics: true,
      tableColumns: ["price", "Sector"],
      watchlistColumns: ["price", "bid"],
      alertWatch: false,
      alertMinutes: 15,
      alertToasts: true,
      checkUpdates: false,
      updateChannel: "rc",
      orderVenue: "xetra",
      tradingAtStart: true,
    } as const;
    expect(sanitizeSettings(valid)).toEqual(valid);
  });

  it("checks for updates at launch by default and keeps an explicit choice", () => {
    expect(DEFAULT_SETTINGS.checkUpdates).toBe(true);
    expect(sanitizeSettings({ checkUpdates: false }).checkUpdates).toBe(false);
    expect(sanitizeSettings({ checkUpdates: "no" }).checkUpdates).toBe(true);
  });

  it("stays on the stable update channel unless release candidates are chosen", () => {
    expect(DEFAULT_SETTINGS.updateChannel).toBe("stable");
    expect(sanitizeSettings({ updateChannel: "rc" }).updateChannel).toBe("rc");
    expect(sanitizeSettings({ updateChannel: "beta" }).updateChannel).toBe("stable");
  });

  it("defaults new orders to EIX and sanitizes the saved venue", () => {
    expect(DEFAULT_SETTINGS.orderVenue).toBe("eix");
    expect(sanitizeSettings({}).orderVenue).toBe("eix");
    expect(sanitizeSettings({ orderVenue: "gettex" }).orderVenue).toBe("gettex");
    expect(sanitizeSettings({ orderVenue: "eix" }).orderVenue).toBe("eix");
    expect(sanitizeSettings({ orderVenue: "account" }).orderVenue).toBe("eix");
    expect(sanitizeSettings({ orderVenue: "unknown" }).orderVenue).toBe("eix");
  });

  it("clamps numbers into their allowed range", () => {
    expect(sanitizeSettings({ fontSize: 2 }).fontSize).toBe(FONT_SIZE_MIN);
    expect(sanitizeSettings({ fontSize: 99 }).fontSize).toBe(FONT_SIZE_MAX);
    expect(sanitizeSettings({ refreshSeconds: 1 }).refreshSeconds).toBe(15);
    expect(sanitizeSettings({ refreshSeconds: 99999 }).refreshSeconds).toBe(3600);
  });

  it("keeps unknown table-column ids", () => {
    expect(sanitizeSettings({ tableColumns: ["price", "private-column", "change"] }).tableColumns).toEqual(["price", "private-column", "change"]);
  });
});

describe("settings storage", () => {
  const memory = new Map<string, string>();

  beforeEach(() => {
    memory.clear();
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) } });
  });

  it("keeps malformed settings under the bad key", () => {
    memory.set(storageKey("settings"), "{not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(memory.get(storageKey("settings.bad"))).toBe("{not json");
  });

  it("preserves extension-owned settings when core settings are saved", () => {
    const settings = parseStoredSettings(JSON.stringify({ tableColumns: ["price", "private-column"], privateSettings: { refresh: 30 } }));
    expect(settings?.tableColumns).toEqual(["price", "private-column"]);
    expect(JSON.parse(serializeSettings(settings!)).privateSettings).toEqual({ refresh: 30 });
  });

  it("keeps separate columns for the Portfolio and the Watchlist", () => {
    const settings = sanitizeSettings({ tableColumns: ["price", "quantity"], watchlistColumns: ["price", "bid"] });
    expect([settings.tableColumns, settings.watchlistColumns]).toEqual([["price", "quantity"], ["price", "bid"]]);
  });

  it("starts the Watchlist with the saved Portfolio columns when it has none of its own", () => {
    expect(sanitizeSettings({ tableColumns: ["price", "quantity"] }).watchlistColumns).toEqual(["price", "quantity"]);
  });
});
