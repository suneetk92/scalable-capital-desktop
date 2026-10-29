// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { removedPlan, useToolQuery } from "./toolActions";
import type { Invoke, ToolDef } from "./tools";

const plan = (isin: string) => ({ kind: "security", instrument: { identifier: isin, name: "ETF" }, amount: "50" });

describe("removedPlan", () => {
  it("drops the plan for the ISIN only in the portfolio of the call", () => {
    const removed = removedPlan({ portfolioId: "pf-1", isin: "IE00B4L5Y983" });
    expect(removed?.match(plan("IE00B4L5Y983"))).toBe(true);
    expect(removed?.match(plan("DE0005190003"))).toBe(false);
    expect(removed?.inEntry({ semantic: { portfolioId: "pf-1" } })).toBe(true);
    expect(removed?.inEntry({ semantic: { portfolioId: "pf-2" } })).toBe(false);
  });

  it("matches by the plan id when the call has one", () => {
    const removed = removedPlan({ savingsPlanId: "plan-7", isin: "IE00B4L5Y983" });
    expect(removed?.match({ ...plan("IE00B4L5Y983"), savingsPlanId: "plan-7" })).toBe(true);
    expect(removed?.match({ ...plan("IE00B4L5Y983"), savingsPlanId: "plan-8" })).toBe(false);
  });

  it("gives null when the call does not say which plan, so the list is read again", () => {
    expect(removedPlan({ isin: "IE00B4L5Y983" })).toBeNull();
    expect(removedPlan({ portfolioId: "pf-1" })).toBeNull();
  });
});

describe("useToolQuery", () => {
  it("shares one call between pages that ask the same question at the same time", async () => {
    const def: ToolDef = { name: "get_account_profile", inputSchema: { properties: {} } };
    const invoke = vi.fn(async () => [{ name: "get_account_profile", ok: true, result: { displayName: "Ada" } }]) as unknown as Invoke;
    const { result } = renderHook(() => [useToolQuery(invoke, [def], "get_account_profile", [{}], 42), useToolQuery(invoke, [def], "get_account_profile", [{}], 42)]);
    await waitFor(() => expect(result.current.every((query) => query.entries[0]?.outcome.ok)).toBe(true));
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
