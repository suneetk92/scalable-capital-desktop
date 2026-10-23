import { describe, expect, it } from "vite-plus/test";
import { initialPlanForm, matchesPlan, monthsFor, NO_PLAN_FILTER, parsePlanConfig, planOf, planRequest } from "./savingsPlan";

// The shape `get_savings_plan_config` publishes in its output schema.
const CONFIG = {
  portfolioId: "p-1",
  security: { isin: "IE00B4L5Y983", name: "iShares Core MSCI World", securityType: "ETF" },
  amountLimits: { min: "25", max: "10000" },
  defaults: { frequency: "MONTHLY", dayOfMonth: 15, yearMonth: "2026-11", dynamizationRate: "0", paymentMethod: "SEPA_DIRECT_DEBIT" },
  frequencies: ["MONTHLY", "QUARTERLY"],
  paymentMethods: ["SEPA_DIRECT_DEBIT", "SAVINGS_ACCOUNT"],
  dynamizationRates: ["0", "0.05"],
  schedules: [
    { dayOfMonth: 1, isDefault: false, isEarliest: false, availableYearMonths: ["2026-12", "2027-01"] },
    { dayOfMonth: 15, isDefault: true, isEarliest: true, availableYearMonths: ["2026-11", "2026-12"] },
  ],
};

describe("parsePlanConfig", () => {
  it("reads limits, options, schedules and defaults", () => {
    const config = parsePlanConfig(CONFIG)!;
    expect(config.min).toBe(25);
    expect(config.max).toBe(10000);
    expect(config.frequencies).toEqual(["MONTHLY", "QUARTERLY"]);
    expect(config.defaults).toEqual({ frequency: "MONTHLY", dayOfMonth: "15", yearMonth: "2026-11", dynamizationRate: "0", paymentMethod: "SEPA_DIRECT_DEBIT" });
    expect(monthsFor(config, "1")).toEqual(["2026-12", "2027-01"]);
    expect(monthsFor(config, "7")).toEqual([]);
  });

  it("accepts the config as a JSON string and rejects anything else", () => {
    expect(parsePlanConfig(JSON.stringify(CONFIG))?.max).toBe(10000);
    expect(parsePlanConfig("not json")).toBeNull();
    expect(parsePlanConfig(null)).toBeNull();
  });
});

describe("initialPlanForm", () => {
  const config = parsePlanConfig(CONFIG)!;

  it("starts from Scalable's defaults", () => {
    expect(initialPlanForm(config, null)).toEqual({ amount: "", frequency: "MONTHLY", dayOfMonth: "15", yearMonth: "2026-11", dynamizationRate: "0", paymentMethod: "SEPA_DIRECT_DEBIT" });
  });

  it("keeps what an existing plan has when the options still allow it", () => {
    const existing = { isin: "IE00B4L5Y983", name: "x", amount: "50", frequency: "QUARTERLY", dayOfMonth: "1", dynamizationRate: "0.05", paymentMethod: "GONE" };
    expect(initialPlanForm(config, existing)).toEqual({ amount: "50", frequency: "QUARTERLY", dayOfMonth: "1", yearMonth: "2026-12", dynamizationRate: "0.05", paymentMethod: "SEPA_DIRECT_DEBIT" });
  });
});

describe("planRequest", () => {
  const config = parsePlanConfig(CONFIG)!;
  const form = { amount: "50,5", frequency: "MONTHLY", dayOfMonth: "15", yearMonth: "2026-11", dynamizationRate: "0", paymentMethod: "SEPA_DIRECT_DEBIT" };

  it("builds the request the backend validates", () => {
    expect(planRequest("IE00B4L5Y983", "p-1", form, config)).toEqual({
      isin: "IE00B4L5Y983",
      portfolioId: "p-1",
      amount: 50.5,
      frequency: "MONTHLY",
      dayOfMonth: 15,
      yearMonth: "2026-11",
      dynamizationRate: "0",
      paymentMethod: "SEPA_DIRECT_DEBIT",
    });
  });

  it("leaves empty fields out so Scalable's defaults apply", () => {
    expect(planRequest("IE00B4L5Y983", "", { ...form, frequency: "", dayOfMonth: "", yearMonth: "", dynamizationRate: "", paymentMethod: "" }, null)).toEqual({
      isin: "IE00B4L5Y983",
      portfolioId: null,
      amount: 50.5,
      frequency: null,
      dayOfMonth: null,
      yearMonth: null,
      dynamizationRate: null,
      paymentMethod: null,
    });
  });

  it("explains what is missing or out of range", () => {
    expect(planRequest("", "p-1", form, config)).toBe("Choose a security first.");
    expect(planRequest("IE00B4L5Y983", "p-1", { ...form, amount: "" }, config)).toMatch(/amount/);
    expect(planRequest("IE00B4L5Y983", "p-1", { ...form, amount: "10" }, config)).toMatch(/smallest amount .* 25/);
    expect(planRequest("IE00B4L5Y983", "p-1", { ...form, amount: "20000" }, config)).toMatch(/largest amount .* 10000/);
    expect(planRequest("IE00B4L5Y983", "p-1", { ...form, dayOfMonth: "40" }, config)).toMatch(/day of the month/);
  });
});

describe("planOf", () => {
  it("reads an entry of list_savings_plans", () => {
    const plan = planOf({
      kind: "security",
      instrument: { identifier: "IE00B4L5Y983", name: "World", securityType: "ETF" },
      amount: "50",
      configuration: { frequency: "MONTHLY", dayOfMonth: 15, dynamizationRate: "0", paymentMethod: "SEPA_DIRECT_DEBIT", nextExecutionDate: "2026-11-15" },
    });
    expect(plan).toEqual({ isin: "IE00B4L5Y983", name: "World", amount: "50", frequency: "MONTHLY", dayOfMonth: "15", dynamizationRate: "0", paymentMethod: "SEPA_DIRECT_DEBIT" });
  });

  it("has no ISIN for crypto plans or a missing instrument", () => {
    expect(planOf({ kind: "crypto", instrument: { identifier: "BTC", name: "Bitcoin" }, amount: "10", configuration: null }).isin).toBeNull();
    expect(planOf({ amount: "10" }).isin).toBeNull();
  });
});

describe("matchesPlan", () => {
  const record = { kind: "security", instrument: { identifier: "IE00B4L5Y983", name: "iShares Core MSCI World" }, amount: 50, configuration: { frequency: "MONTHLY" } };
  it("filters by text and frequency", () => {
    expect(matchesPlan(record, NO_PLAN_FILTER)).toBe(true);
    expect(matchesPlan(record, { ...NO_PLAN_FILTER, text: "msci" })).toBe(true);
    expect(matchesPlan(record, { ...NO_PLAN_FILTER, text: "ie00b4" })).toBe(true);
    expect(matchesPlan(record, { ...NO_PLAN_FILTER, text: "sap" })).toBe(false);
    expect(matchesPlan(record, { ...NO_PLAN_FILTER, frequency: "MONTHLY" })).toBe(true);
    expect(matchesPlan(record, { ...NO_PLAN_FILTER, frequency: "WEEKLY" })).toBe(false);
  });
});
