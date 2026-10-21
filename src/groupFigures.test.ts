import { describe, expect, it } from "vitest";
import { withGroupExtras } from "./groupFigures";
import type { SecurityGroup } from "./groups";
import type { ExistingPlan } from "./savingsPlan";

const group = (over: Partial<SecurityGroup> = {}): SecurityGroup => ({
  id: "g",
  name: "G",
  description: "",
  portfolioId: "p1",
  isins: ["DE0000000001", "DE0000000002"],
  portfolioIds: [],
  holdings: [],
  valuation: null,
  currency: "EUR",
  sinceBuyPerformance: null,
  sinceBuyAbsolute: null,
  pendingOrders: null,
  savingsPlansAmount: null,
  ...over,
});
const plan = (isin: string, amount: string): ExistingPlan => ({ isin, name: isin, amount, frequency: "", dayOfMonth: "", dynamizationRate: "", paymentMethod: "" });

describe("withGroupExtras", () => {
  const extras = {
    orders: [
      { portfolioId: "p1", item: { isin: "DE0000000001" } },
      { portfolioId: "p1", item: { isin: "DE0000000009" } },
      { portfolioId: "p2", item: { isin: "DE0000000002" } },
      { portfolioId: "p1", item: { isin: null } },
    ],
    plans: [
      { portfolioId: "p1", item: plan("DE0000000001", "25") },
      { portfolioId: "p1", item: plan("DE0000000002", "10,5") },
      { portfolioId: "p1", item: plan("DE0000000009", "99") },
    ],
  };

  it("counts the open orders and adds the savings plans of the group's holdings", () => {
    const filled = withGroupExtras(group(), extras);
    expect(filled.pendingOrders).toBe(1);
    expect(filled.savingsPlansAmount).toBe(35.5);
  });

  it("keeps the figures Scalable reports", () => {
    const filled = withGroupExtras(group({ pendingOrders: 4, savingsPlansAmount: 7 }), extras);
    expect([filled.pendingOrders, filled.savingsPlansAmount]).toEqual([4, 7]);
  });

  it("shows zero when nothing matches and leaves unknown figures unknown", () => {
    const empty = withGroupExtras(group({ isins: ["DE0000000008"] }), extras);
    expect([empty.pendingOrders, empty.savingsPlansAmount]).toEqual([0, 0]);
    const unknown = withGroupExtras(group(), { orders: null, plans: null });
    expect([unknown.pendingOrders, unknown.savingsPlansAmount]).toEqual([null, null]);
  });

  it("matches every portfolio when the group spans several", () => {
    expect(withGroupExtras(group({ portfolioId: "" }), extras).pendingOrders).toBe(2);
  });
});
