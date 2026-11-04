import { describe, expect, it } from "vite-plus/test";
import { filterTrailingStops, parseTrailingList, statusLabel, trailIssue, trailLabel, trailingCsvRows, trailingStopNotice, triggerBarShare, triggerPrice, waitingNote } from "./trailing";

const stop = {
  id: "a",
  isin: "US0378331005",
  name: "Apple",
  portfolioId: "p-1",
  shares: 2,
  trail: { kind: "percent", value: 5 },
  startPrice: 100,
  high: 120,
  lastPrice: 118,
  status: "active",
  message: null,
  createdAt: 1,
};

describe("triggerPrice", () => {
  it("sits below the high by the percentage or the amount", () => {
    expect(triggerPrice(200, { kind: "percent", value: 10 })).toBe(180);
    expect(triggerPrice(200, { kind: "amount", value: 15 })).toBe(185);
  });
});

describe("trailing-stop notices", () => {
  it("names added and changed stops", () => {
    expect(trailingStopNotice("added", "sell", "Apple")).toEqual({ kind: "ok", title: "Trailing stop added", text: "Apple · trailing stop added" });
    expect(trailingStopNotice("changed", "buy", "Microsoft")).toEqual({ kind: "ok", title: "Trailing buy stop changed", text: "Microsoft · trailing buy stop changed" });
  });
});

describe("trailing-stop table helpers", () => {
  it("filters by status without changing the source list", () => {
    const stops = parseTrailingList({ stops: [stop, { ...stop, id: "b", status: "attention" }, { ...stop, id: "c", status: "sold" }] }).stops;

    expect(filterTrailingStops(stops, "all")).toBe(stops);
    expect(filterTrailingStops(stops, "attention").map((item) => item.id)).toEqual(["b"]);
    expect(filterTrailingStops(stops, "sold").map((item) => item.id)).toEqual(["c"]);
    expect(stops.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("builds CSV rows for the displayed stop data and Scalable execution details", () => {
    const stops = parseTrailingList({
      stops: [stop, { ...stop, id: "b", name: "Microsoft", isin: "US5949181045", side: "buy", shares: 0, amount: 250, high: 100, status: "sold", lastPrice: null }],
    }).stops;
    const details = new Map([
      ["a", { status: "Watching", executionTime: null, executionPrice: null }],
      ["b", { status: "Order placed · Submitted", executionTime: "2026-11-04T04:41:00Z", executionPrice: "€ 101.00" }],
    ]);

    expect(trailingCsvRows(stops, details)).toEqual([
      ["Symbol / name", "ISIN", "Status", "Amount / shares", "Distance", "Highest / lowest price", "Trigger price", "Now", "Execution time", "Execution price"],
      ["Apple", "US0378331005", "Watching", 2, "5 %", 120, 114, 118, null, null],
      ["Microsoft", "US5949181045", "Order placed · Submitted", 250, "5 %", 100, 105, null, "2026-11-04T04:41:00Z", "€ 101.00"],
    ]);
  });
});

describe("buy stops", () => {
  it.each(["percent", "amount"] as const)("trigger above the low and fill the %s bar as the price rises", (kind) => {
    const trail = { kind, value: 10 };
    expect(triggerPrice(100, trail, "buy")).toBeCloseTo(110);
    expect(triggerPrice(100, { kind: "amount", value: 5 }, "buy")).toBe(105);
    expect(triggerBarShare(100, 100, trail, "buy")).toBe(0);
    expect(triggerBarShare(101, 100, trail, "buy")).toBeCloseTo(0.1);
    expect(triggerBarShare(105, 100, trail, "buy")).toBeCloseTo(0.5);
    expect(triggerBarShare(109, 100, trail, "buy")).toBeCloseTo(0.9);
    expect(triggerBarShare(triggerPrice(100, trail, "buy"), 100, trail, "buy")).toBe(1);
    expect(triggerBarShare(112, 100, trail, "buy")).toBe(1);
    expect(triggerBarShare(95, 100, trail, "buy")).toBe(0);
  });

  it("read as bought, not sold", () => {
    expect(statusLabel("buy", "sold")).toBe("Order placed");
    expect(statusLabel("sell", "sold")).toBe("Order placed");
    expect(statusLabel("buy", "sold", true)).toBe("Bought");
    expect(statusLabel("sell", "sold", true)).toBe("Sold");
    expect(parseTrailingList({ stops: [{ ...stop, side: "buy", shares: 0, amount: 250 }] }).stops[0]).toMatchObject({ side: "buy", amount: 250 });
    expect(parseTrailingList({ stops: [stop] }).stops[0].side).toBe("sell");
  });
});

describe("waitingNote", () => {
  it("says when a watching stop reached its trigger or cannot trade yet", () => {
    expect(waitingNote({ status: "active", triggerReached: true }, false)).toBe("Trigger reached, needs Full access");
    expect(waitingNote({ status: "active", triggerReached: true }, true)).toBe("Trigger reached, needs Full access");
    expect(waitingNote({ status: "active", triggerReached: false }, false)).toBe("Watching, Full access is off");
    expect(waitingNote({ status: "active", triggerReached: false }, true)).toBeNull();
    expect(waitingNote({ status: "sold", triggerReached: true }, false)).toBeNull();
  });

  it("reads the reached flag from the backend and defaults it to false", () => {
    expect(parseTrailingList({ stops: [{ ...stop, triggerReached: true }] }).stops[0].triggerReached).toBe(true);
    expect(parseTrailingList({ stops: [stop] }).stops[0].triggerReached).toBe(false);
  });
});

describe("triggerBarShare", () => {
  it.each([
    { kind: "percent", value: 10 },
    { kind: "amount", value: 20 },
  ] as const)("keeps sell bars full at the high and empty at the trigger with $kind trails", (trail) => {
    expect(triggerBarShare(200, 200, trail)).toBe(1);
    expect(triggerBarShare(190, 200, trail)).toBeCloseTo(0.5);
    expect(triggerBarShare(180, 200, trail)).toBe(0);
    expect(triggerBarShare(170, 200, trail)).toBe(0);
    expect(triggerBarShare(210, 200, trail)).toBe(1);
  });
});

describe("trailIssue", () => {
  it("needs a positive distance, below 100 % for a percentage", () => {
    expect(trailIssue("percent", null)).not.toBeNull();
    expect(trailIssue("amount", 0)).not.toBeNull();
    expect(trailIssue("percent", 100)).not.toBeNull();
    expect(trailIssue("percent", 5)).toBeNull();
    expect(trailIssue("amount", 250)).toBeNull();
  });
});

describe("trailLabel", () => {
  it("writes a percentage or a formatted amount", () => {
    expect(trailLabel({ kind: "percent", value: 5 }, String)).toBe("5 %");
    expect(trailLabel({ kind: "amount", value: 2 }, (value) => `${value} EUR`)).toBe("2 EUR");
  });
});

describe("parseTrailingList", () => {
  it("keeps well-formed stops and the problem text", () => {
    const list = parseTrailingList({ stops: [stop, { id: "broken" }, { ...stop, id: "b", status: "weird" }], problem: "No price" });
    expect(list.stops.map((item) => item.id)).toEqual(["a"]);
    expect(list.stops[0]).toMatchObject({ high: 120, lastPrice: 118, portfolioId: "p-1" });
    expect(list.problem).toBe("No price");
  });

  it("copes with nothing useful", () => {
    expect(parseTrailingList(null)).toEqual({ stops: [], problem: null, lastChecked: null });
    expect(parseTrailingList({ stops: "x" })).toEqual({ stops: [], problem: null, lastChecked: null });
  });
});
