import { describe, expect, it } from "vitest";
import { isFinalState, orderIdOf, orderStateLabel, orderStateOf } from "./orderState";

describe("order state", () => {
  it("reads the order id from the receipt", () => {
    expect(orderIdOf({ orderId: "o-1", status: "submitted" })).toBe("o-1");
    expect(orderIdOf(null)).toBeUndefined();
  });

  it("prefers the finalisation reason, then the trade status, then the latest history entry", () => {
    const history = [
      { state: "SUBMITTED", timestamp: "2026-10-28T20:22:00Z" },
      { state: "SETTLED", timestamp: "2026-10-30T06:00:00Z" },
    ];
    const trade = { status: "SETTLED", finalisationReason: "FILLED" };
    expect(orderStateOf({ transaction: { securityTrade: trade, history } })).toEqual({ state: "FILLED", final: true, history });
    expect(orderStateOf({ transaction: { securityTrade: { status: "EXECUTED", finalisationReason: null } } })).toEqual({ state: "EXECUTED", final: false, history: [] });
    expect(orderStateOf({ transaction: { securityTrade: null, history } })?.state).toBe("SETTLED");
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
