import { describe, expect, it } from "vite-plus/test";
import { connectionCheckDue, MAX_REFRESH_BACKOFF_MS, nextRefreshDelay, wokeFromSleep } from "./refreshSchedule";

describe("refresh schedule", () => {
  it("keeps the chosen interval while reloads succeed and doubles it per failure up to the cap", () => {
    expect(nextRefreshDelay(60_000, 0)).toBe(60_000);
    expect(nextRefreshDelay(60_000, 1)).toBe(120_000);
    expect(nextRefreshDelay(60_000, 3)).toBe(480_000);
    expect(nextRefreshDelay(60_000, 4)).toBe(MAX_REFRESH_BACKOFF_MS);
    expect(nextRefreshDelay(60_000, 1000)).toBe(MAX_REFRESH_BACKOFF_MS);
    expect(nextRefreshDelay(15_000, -1)).toBe(15_000);
  });

  it("skips the ping while a recent account load already proved the connection", () => {
    expect(connectionCheckDue(null, 1_000_000, 60_000)).toBe(true);
    expect(connectionCheckDue(1_000_000 - 30_000, 1_000_000, 60_000)).toBe(false);
    expect(connectionCheckDue(1_000_000 - 60_000, 1_000_000, 60_000)).toBe(true);
  });

  it("treats a delayed timer as sleep only beyond the interval plus one minute", () => {
    expect(wokeFromSleep(0, 90_000, 30_000)).toBe(false);
    expect(wokeFromSleep(0, 90_001, 30_000)).toBe(true);
    expect(wokeFromSleep(100_000, 99_999, 30_000)).toBe(false);
  });
});
