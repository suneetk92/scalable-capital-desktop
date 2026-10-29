import { describe, expect, it } from "vite-plus/test";
import { loadSequence } from "./loadSequence";

describe("loadSequence", () => {
  it("uses only the newest of two overlapping loads and stays busy until both end", () => {
    const loads = loadSequence();
    const first = loads.start();
    const second = loads.start();
    // The older load ends first: its result is stale and the newer one still runs.
    expect(loads.current(first)).toBe(false);
    expect(loads.finish()).toBe(false);
    expect(loads.busy()).toBe(true);
    expect(loads.current(second)).toBe(true);
    expect(loads.finish()).toBe(true);
    expect(loads.busy()).toBe(false);
  });

  it("drops an older result that arrives after the newer one", () => {
    const loads = loadSequence();
    const first = loads.start();
    const second = loads.start();
    expect(loads.current(second)).toBe(true);
    loads.finish();
    expect(loads.current(first)).toBe(false);
    expect(loads.finish()).toBe(true);
  });

  it("drops a load that was running when it was invalidated, such as by a sign-out", () => {
    const loads = loadSequence();
    const before = loads.start();
    loads.invalidate();
    expect(loads.current(before)).toBe(false);
    expect(loads.finish()).toBe(true);
    const after = loads.start();
    expect(loads.current(after)).toBe(true);
  });

  it("never counts below zero", () => {
    const loads = loadSequence();
    expect(loads.finish()).toBe(true);
    loads.start();
    expect(loads.busy()).toBe(true);
  });
});
