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
    expect(orderStateOf({ transaction: { securityTrade: trade, history } })).toMatchObject({ state: "FILLED", final: true, history });
    expect(orderStateOf({ transaction: { securityTrade: { status: "EXECUTED", finalisationReason: null } } })).toMatchObject({ state: "EXECUTED", final: false, history: [] });
    expect(orderStateOf({ transaction: { securityTrade: null, history } })?.state).toBe("SETTLED");
    expect(orderStateOf({ nothing: true })).toBeNull();
  });

  it("uses the latest execution in transaction history and its currency", () => {
    const order = orderStateOf({
      transaction: {
        currency: "USD",
        securityTrade: { status: "SETTLED", finalisationReason: "FILLED", averagePrice: "189.25" },
        history: [
          { state: "SUBMITTED", timestamp: "2026-10-28T20:22:00Z" },
          { state: "PARTIALLY_FILLED", timestamp: "2026-10-29T12:00:00Z", executionPrice: "190.00" },
          { state: "FILLED", timestamp: "2026-10-30T05:30:00Z", executionPrice: "189.50" },
          { state: "SETTLED", timestamp: "2026-10-30T06:00:00Z" },
        ],
      },
    });

    expect(order).toMatchObject({
      executionPrice: 189.5,
      executionTime: "2026-10-30T05:30:00Z",
      currency: "USD",
      executionChecked: true,
    });
  });

  it("falls back to transaction execution fields and ignores malformed values", () => {
    expect(
      orderStateOf({
        transaction: {
          currency: "EUR",
          securityTrade: { status: "SETTLED", averagePrice: "94.75" },
          history: [{ state: "FILLED", timestamp: "2026-10-30T06:00:00Z" }],
        },
      }),
    ).toMatchObject({ executionPrice: 94.75, executionTime: "2026-10-30T06:00:00Z", currency: "EUR" });
    expect(
      orderStateOf({
        transaction: {
          securityTrade: { status: "SETTLED", averagePrice: "not a price" },
          history: [{ state: "SETTLED", timestamp: "2026-10-30T06:00:00Z", executionPrice: "bad" }],
        },
      }),
    ).toMatchObject({ executionPrice: null, executionTime: null, currency: null });
  });

  it("marks successful transaction responses checked even when Scalable reports no state or fill", () => {
    expect(orderStateOf({ transaction: { securityTrade: null, history: [] } })).toMatchObject({
      state: "unknown",
      final: false,
      executionPrice: null,
      executionTime: null,
      executionChecked: true,
    });
  });

  it("stops asking once the order cannot change", () => {
    expect(isFinalState("SETTLED")).toBe(true);
    expect(isFinalState("cancelled")).toBe(true);
    expect(isFinalState("FILLED")).toBe(false);
    expect(isFinalState("submitted")).toBe(false);
    expect(orderStateLabel("SETTLED")).toBe("Settled");
  });
});
