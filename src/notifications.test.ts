import { describe, expect, it } from "vitest";
import { addNotification, alertAddedNotice, alertRemovedNotice, formatAge, NOTIFICATION_LIMIT, removeNotification, toolSuccessNotice } from "./notifications";

describe("notification list", () => {
  it("puts the newest first and keeps at most the limit", () => {
    let items = addNotification([], { kind: "ok", text: "one" }, 1, 100);
    items = addNotification(items, { kind: "error", text: "two" }, 2, 200);
    expect(items.map((item) => item.text)).toEqual(["two", "one"]);
    for (let id = 3; id < NOTIFICATION_LIMIT + 10; id += 1) items = addNotification(items, { kind: "info", text: String(id) }, id, id);
    expect(items).toHaveLength(NOTIFICATION_LIMIT);
    expect(items[0]?.id).toBe(NOTIFICATION_LIMIT + 9);
  });

  it("removes one item", () => {
    let items = addNotification([], { kind: "ok", text: "one" }, 1, 100);
    items = addNotification(items, { kind: "ok", text: "two" }, 2, 200);
    expect(removeNotification(items, 1).map((item) => item.id)).toEqual([2]);
  });
});

describe("formatAge", () => {
  it("is relative for the first day", () => {
    const now = 10 * 3_600_000;
    expect(formatAge(now - 20_000, now)).toBe("just now");
    expect(formatAge(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(formatAge(now - 3 * 3_600_000, now)).toBe("3 h ago");
  });
});

describe("alert messages", () => {
  it("says which alert was added at what price", () => {
    expect(alertAddedNotice({ name: "Apple", price: "190", direction: "up" })).toMatchObject({ title: "Price alert added", text: "Apple · alert at 190 (above)" });
    expect(alertAddedNotice({ name: "Apple" }).text).toBe("Apple · alert added");
  });

  it("says which alert was removed", () => {
    expect(alertRemovedNotice({ name: "Apple", price: "190", direction: "down" })).toMatchObject({ title: "Price alert removed", text: "Apple · alert at 190 (below) removed" });
  });

  it("describes a create from the runner dialog by instrument and price", () => {
    const notice = toolSuccessNotice("create_price_alert", { instrument: { kind: "security", isin: "US0378331005" }, price: 190.5 }, {});
    expect(notice).toMatchObject({ title: "Price alert added", text: "US0378331005 · alert at 190.5" });
    expect(toolSuccessNotice("create_price_alert", { instrument: { kind: "security", isin: "X" }, price: "1" }, { instrument: { name: "Apple" } }).text).toBe("Apple · alert at 1");
    expect(toolSuccessNotice("remove_price_alert", { alertId: "a1" }, {}).text).toBe("Alert a1 removed");
    expect(toolSuccessNotice("cancel_something", {}, {})).toEqual({ kind: "ok", text: "Cancel something done." });
  });
});
