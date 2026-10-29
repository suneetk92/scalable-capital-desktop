// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { alertMessage, alertNotices, checkAlerts, loadNotified, matchesAlert, NO_ALERT_FILTER, parseAlerts, saveNotified, trimNotified } from "./alerts";
import { writeStoredJson } from "./storage";

const open = {
  alertId: "a1",
  direction: "UP",
  instrument: { identifier: "DE0005190003", kind: "security", name: "BMW St.", securityType: "STOCK" },
  isActive: true,
  price: "98",
  triggeredTimestampUtc: null,
};
const fired = { ...open, alertId: "a2", direction: "DOWN", price: "44", isActive: false, triggeredTimestampUtc: "2026-10-15T08:00:00Z" };

describe("parseAlerts", () => {
  it("reads the live list_price_alerts shape", () => {
    const [first, second] = parseAlerts([open, fired]);
    expect(first).toMatchObject({ id: "a1", name: "BMW St.", isin: "DE0005190003", direction: "up", targetPrice: "98", triggeredAt: undefined });
    expect(second).toMatchObject({ id: "a2", direction: "down", triggeredAt: "2026-10-15T08:00:00Z" });
  });

  it("drops records without an id", () => {
    expect(parseAlerts([{ price: "1" }])).toEqual([]);
  });
});

describe("checkAlerts", () => {
  it("records what already fired on the first check without announcing it", () => {
    const result = checkAlerts(parseAlerts([open, fired]), null);
    expect(result.announce).toEqual([]);
    expect([...result.notified]).toEqual(["a2"]);
  });

  it("announces fired alerts that were not announced yet, oldest first", () => {
    const later = { ...fired, alertId: "a3", triggeredTimestampUtc: "2026-10-15T09:00:00Z" };
    const alerts = parseAlerts([later, open, fired]);
    expect(checkAlerts(alerts, new Set()).announce.map((alert) => alert.id)).toEqual(["a2", "a3"]);
    expect(checkAlerts(alerts, new Set(["a2"])).announce.map((alert) => alert.id)).toEqual(["a3"]);
  });

  it("announces an alert that fires between two checks, once", () => {
    const first = checkAlerts(parseAlerts([open]), null);
    const second = checkAlerts(parseAlerts([{ ...open, isActive: false, triggeredTimestampUtc: "2026-10-15T10:00:00Z" }]), first.notified);
    expect(second.announce.map((alert) => alert.id)).toEqual(["a1"]);
    expect(checkAlerts(parseAlerts([{ ...open, triggeredTimestampUtc: "2026-10-15T10:00:00Z" }]), second.notified).announce).toEqual([]);
  });
});

describe("alertMessage", () => {
  it("describes one alert", () => {
    expect(alertMessage(parseAlerts([fired]))).toEqual({ title: "Price alert triggered", body: "BMW St. fell to 44" });
  });

  it("summarises many alerts", () => {
    const many = parseAlerts(Array.from({ length: 7 }, (_, index) => ({ ...fired, alertId: `x${index}` })));
    const message = alertMessage(many);
    expect(message.title).toBe("7 price alerts triggered");
    expect(message.body.split("\n")).toHaveLength(6);
    expect(message.body.endsWith("and 2 more")).toBe(true);
  });
});

describe("alertNotices", () => {
  it("gives every fired alert its own notice with the price and the time", () => {
    const other = { ...fired, alertId: "a3", direction: "UP", price: "120" };
    const notices = alertNotices(parseAlerts([fired, other]));
    expect(notices).toHaveLength(2);
    expect(notices[0]).toMatchObject({ kind: "info", title: "Price alert triggered", text: "BMW St. fell to 44" });
    expect(notices[0]?.detail).toMatch(/^Triggered /);
    expect(notices[1]?.text).toBe("BMW St. rose to 120");
  });
});

describe("matchesAlert", () => {
  it("filters by text, direction and status", () => {
    expect(matchesAlert(open, NO_ALERT_FILTER)).toBe(true);
    expect(matchesAlert(open, { ...NO_ALERT_FILTER, text: "bmw" })).toBe(true);
    expect(matchesAlert(open, { ...NO_ALERT_FILTER, text: "de000519" })).toBe(true);
    expect(matchesAlert(open, { ...NO_ALERT_FILTER, text: "sap" })).toBe(false);
    expect(matchesAlert(open, { ...NO_ALERT_FILTER, direction: "up" })).toBe(true);
    expect(matchesAlert(open, { ...NO_ALERT_FILTER, direction: "down" })).toBe(false);
    expect(matchesAlert(open, { ...NO_ALERT_FILTER, status: "triggered" })).toBe(false);
  });
});

describe("announced alerts per portfolio", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps one list per portfolio, so another account or portfolio starts unchecked", () => {
    saveNotified(new Set(["a2"]), "pf-1");
    expect(loadNotified("pf-1")).toEqual(new Set(["a2"]));
    expect(loadNotified("pf-2")).toBeNull();
    expect(window.localStorage.getItem("scalable-capital-desktop.alerts-notified.pf-1")).toBe('["a2"]');
  });

  it("takes the shared list of older versions for a portfolio without its own", () => {
    writeStoredJson("alerts-notified", ["a2"]);
    expect(loadNotified("pf-1")).toEqual(new Set(["a2"]));
  });

  it("keeps the ids of alerts Scalable still lists when the list is trimmed", () => {
    const listed = parseAlerts([{ ...fired, alertId: "old" }]);
    expect(trimNotified(new Set(["old", "b", "c", "d"]), listed, 2)).toEqual(["old", "d"]);
    expect(trimNotified(new Set(["a", "b"]), [], 2)).toEqual(["a", "b"]);
  });
});
