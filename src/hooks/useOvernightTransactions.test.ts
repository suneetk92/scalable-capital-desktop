// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ToolActions } from "../toolActions";
import type { Invoke, ToolDef } from "../tools";
import { useOvernightTransactions } from "./useOvernightTransactions";

const def: ToolDef = { name: "list_overnight_transactions", inputSchema: { properties: { savingsAccountId: { type: "string" }, pageSize: { type: "integer" }, cursor: { type: "string" } } } };
const actions = { has: () => true } as unknown as ToolActions;
const filters = { searchTerm: "", type: "all", period: "all" } as const;
const page = (ids: string[], nextCursor: string | null) => ({ savingsAccountId: "sa-1", transactions: ids.map((id) => ({ id, amount: "1" })), page: { nextCursor, totalCount: 9 } });

describe("useOvernightTransactions", () => {
  it("keeps the pages loaded so far when the data is reloaded", async () => {
    const answers = [page(["t2", "t1"], "c1"), page(["t0"], "c2"), page(["t3", "t2"], "c1")];
    const invoke = vi.fn(async () => [{ name: "list_overnight_transactions", ok: true, result: answers.shift() }]) as unknown as Invoke;
    const { result, rerender } = renderHook(({ reloadKey }) => useOvernightTransactions({ invoke, defs: [def], actions, pageSize: 2, reloadKey }, filters), { initialProps: { reloadKey: 1 } });
    await waitFor(() => expect(result.current.rows.map((row) => row.id)).toEqual(["t2", "t1"]));
    await act(() => result.current.loadMore());
    expect(result.current.rows.map((row) => row.id)).toEqual(["t2", "t1", "t0"]);
    rerender({ reloadKey: 2 });
    // While the reload runs the rows stay; afterwards the new transaction is on top and "Load more" carries on after page 2.
    expect(result.current.rows.map((row) => row.id)).toEqual(["t2", "t1", "t0"]);
    await waitFor(() => expect(result.current.rows.map((row) => row.id)).toEqual(["t3", "t2", "t1", "t0"]));
    expect(result.current.nextCursor).toBe("c2");
  });
});
