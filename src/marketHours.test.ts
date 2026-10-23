import { describe, expect, it } from "vite-plus/test";
import { exchangeOpen } from "./marketHours";

describe("exchangeOpen", () => {
  it("is open from 06:00 to before 23:00 Berlin time on weekdays", () => {
    expect(exchangeOpen(new Date("2026-10-22T03:59:00Z"))).toBe(false);
    expect(exchangeOpen(new Date("2026-10-22T04:00:00Z"))).toBe(true);
    expect(exchangeOpen(new Date("2026-10-22T20:59:00Z"))).toBe(true);
    expect(exchangeOpen(new Date("2026-10-22T21:00:00Z"))).toBe(false);
    expect(exchangeOpen(new Date("2026-12-03T05:00:00Z"))).toBe(true);
    expect(exchangeOpen(new Date("2026-12-03T04:59:00Z"))).toBe(false);
  });

  it("is closed on weekends and exchange holidays", () => {
    expect(exchangeOpen(new Date("2026-10-24T10:00:00Z"))).toBe(false);
    expect(exchangeOpen(new Date("2026-10-25T10:00:00Z"))).toBe(false);
    expect(exchangeOpen(new Date("2026-04-03T10:00:00Z"))).toBe(false);
    expect(exchangeOpen(new Date("2026-04-06T10:00:00Z"))).toBe(false);
    expect(exchangeOpen(new Date("2026-04-07T10:00:00Z"))).toBe(true);
    expect(exchangeOpen(new Date("2026-05-01T10:00:00Z"))).toBe(false);
    expect(exchangeOpen(new Date("2026-12-24T10:00:00Z"))).toBe(false);
    expect(exchangeOpen(new Date("2026-12-23T10:00:00Z"))).toBe(true);
    expect(exchangeOpen(new Date("2026-08-14T10:00:00Z"))).toBe(true);
  });

  it("opens late on some holidays and closes early on 30 December", () => {
    expect(exchangeOpen(new Date("2026-05-14T05:29:00Z"))).toBe(false);
    expect(exchangeOpen(new Date("2026-05-14T05:30:00Z"))).toBe(true);
    expect(exchangeOpen(new Date("2026-01-06T06:29:00Z"))).toBe(false);
    expect(exchangeOpen(new Date("2026-01-06T06:30:00Z"))).toBe(true);
    expect(exchangeOpen(new Date("2026-12-30T12:59:00Z"))).toBe(true);
    expect(exchangeOpen(new Date("2026-12-30T13:00:00Z"))).toBe(false);
  });
});
