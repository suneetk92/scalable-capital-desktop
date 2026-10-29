import { describe, expect, it } from "vitest";
import { isFinalState, orderIdOf, orderStateLabel, orderStateOf } from "./orderState";

describe("order state", () => {
  it("reads the order id from the receipt", () => {
    expect(orderIdOf({ orderId: "o-1", status: "submitted" })).toBe("o-1");
    expect(orderIdOf(null)).toBeUndefined();
  });

  it("prefers the finalisation reason, then the trade status, then the latest history entry", () => {
    const trade = { status: "SETTLED", finalisationReason: "FILLED" };
    expect(orderStateOf({ transaction: { securityTrade: trade, history: [{ state: "SUBMITTED" }] } })).toEqual({ state: "FILLED", final: true });
    expect(orderStateOf({ transaction: { securityTrade: { status: "EXECUTED", finalisationReason: null } } })).toEqual({ state: "EXECUTED", final: false });
    expect(orderStateOf({ transaction: { securityTrade: null, history: [{ state: "SUBMITTED" }, { state: "SETTLED" }] } })).toEqual({ state: "SETTLED", final: true });
    expect(orderStateOf({ nothing: true })).toBeNull();
  });

  it("stops asking once the order cannot change", () => {
    expect(isFinalState("SETTLED")).toBe(true);
    expect(isFinalState("cancelled")).toBe(true);
    expect(isFinalState("FILLED")).toBe(false);
    expect(isFinalState("submitted")).toBe(false);
    expect(orderStateLabel("SETTLED")).toBe("Settled");
  });
});
