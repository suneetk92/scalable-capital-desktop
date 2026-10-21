import { describe, expect, it } from "vitest";
import { alertMessage, alertNotices, checkAlerts, parseAlerts } from "./alerts";

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
