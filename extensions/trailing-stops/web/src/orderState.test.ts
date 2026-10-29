import { describe, expect, it } from "vitest";
import { isFinalState, orderIdOf, orderStateLabel, orderStateOf } from "./orderState";

describe("order state", () => {
  it("reads the order id from the receipt", () => {
    expect(orderIdOf({ orderId: "o-1", status: "submitted" })).toBe("o-1");
    expect(orderIdOf(null)).toBeUndefined();
  });

  it("prefers the trade status, else the latest history entry", () => {
    expect(orderStateOf({ transaction: { id: "o-1", securityTrade: { status: "FILLED" }, history: [{ state: "SUBMITTED" }] } })).toBe("FILLED");
    expect(orderStateOf({ transaction: { id: "o-1", securityTrade: null, history: [{ state: "SUBMITTED" }, { state: "SETTLED" }] } })).toBe("SETTLED");
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
