import { describe, expect, it } from "vite-plus/test";
import { parseTrailingList, statusLabel, trailIssue, trailLabel, triggerMargin, triggerPrice } from "./trailing";

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

describe("buy stops", () => {
  it("trigger above the low and use up the margin as the price rises", () => {
    const trail = { kind: "percent", value: 10 } as const;
    expect(triggerPrice(100, trail, "buy")).toBeCloseTo(110);
    expect(triggerPrice(100, { kind: "amount", value: 5 }, "buy")).toBe(105);
    expect(triggerMargin(100, 100, trail, "buy")).toBe(1);
    expect(triggerMargin(105, 100, trail, "buy")).toBeCloseTo(0.5);
    expect(triggerMargin(112, 100, trail, "buy")).toBe(0);
    expect(triggerMargin(95, 100, trail, "buy")).toBe(1);
  });

  it("read as bought, not sold", () => {
    expect(statusLabel("buy", "sold")).toBe("Bought");
    expect(statusLabel("sell", "sold")).toBe("Sold");
    expect(parseTrailingList({ stops: [{ ...stop, side: "buy", shares: 0, amount: 250 }] }).stops[0]).toMatchObject({ side: "buy", amount: 250 });
    expect(parseTrailingList({ stops: [stop] }).stops[0].side).toBe("sell");
  });
});

describe("triggerMargin", () => {
  it("is 1 at the high, 0 at the trigger and stays within that range", () => {
    const trail = { kind: "percent", value: 10 } as const;
    expect(triggerMargin(200, 200, trail)).toBe(1);
    expect(triggerMargin(190, 200, trail)).toBeCloseTo(0.5);
    expect(triggerMargin(180, 200, trail)).toBe(0);
    expect(triggerMargin(170, 200, trail)).toBe(0);
    expect(triggerMargin(210, 200, trail)).toBe(1);
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
