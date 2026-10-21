import { describe, expect, it } from "vitest";
import { parseTrailingList, trailIssue, trailLabel, triggerPrice } from "./trailing";

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
    expect(parseTrailingList(null)).toEqual({ stops: [], problem: null });
    expect(parseTrailingList({ stops: "x" })).toEqual({ stops: [], problem: null });
  });
});
