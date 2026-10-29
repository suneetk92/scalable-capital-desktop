import { useCallback, useEffect, useRef, useState } from "react";
import { appendPage, overnightRequest, parseOvernightPage, type OvernightAccount, type OvernightPeriod, type OvernightTransaction, type OvernightType } from "../overnight";
import { buildArgs, callTools } from "../tools";
import type { Common } from "../types";

const TOOL_NAME = "list_overnight_transactions";

type OvernightState = {
  rows: OvernightTransaction[];
  account: OvernightAccount | null;
  total: number;
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
};

const EMPTY_STATE: OvernightState = { rows: [], account: null, total: 0, nextCursor: null, loading: false, error: null };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useOvernightTransactions(
  common: Pick<Common, "invoke" | "defs" | "actions" | "pageSize" | "reloadKey">,
  filters: { searchTerm: string; type: OvernightType; period: OvernightPeriod },
) {
  const { invoke, defs, actions, reloadKey } = common;
  const offered = actions.has(TOOL_NAME);
  const def = defs.find((item) => item.name === TOOL_NAME);
  const defKey = def ? JSON.stringify(def) : "";
  const pageSize = common.pageSize === 0 ? 100 : Math.min(100, Math.max(1, Math.floor(common.pageSize)));
  const requestId = useRef(0);
  const requestBase = useRef<Record<string, unknown>>({});
  const savingsAccountId = useRef<string | undefined>(undefined);
  const [state, setState] = useState<OvernightState>(EMPTY_STATE);
  // What the shown rows were loaded for, and how many pages: a reload with the same filters refreshes them in place.
  const shownFor = useRef<string | null>(null);
  const pagesShown = useRef(0);
  const filterKey = JSON.stringify([offered, defKey, filters.searchTerm, filters.type, filters.period, pageSize]);

  useEffect(() => {
    const id = ++requestId.current;
    const inPlace = shownFor.current === filterKey && pagesShown.current > 0;
    if (!inPlace) savingsAccountId.current = undefined;
    if (!offered || !def) {
      shownFor.current = null;
      pagesShown.current = 0;
    }
    if (!offered) {
      setState(EMPTY_STATE);
      return;
    }
    if (!def) {
      setState({ ...EMPTY_STATE, error: "The overnight transactions tool definition is unavailable." });
      return;
    }
    const semantic = overnightRequest({ ...filters, pageSize, savingsAccountId: inPlace ? savingsAccountId.current : undefined });
    requestBase.current = overnightRequest({ ...filters, pageSize });
    // New filters start over; a refresh keeps the rows on screen and puts the newest page on top of them.
    if (inPlace) setState((current) => ({ ...current, loading: true }));
    else {
      shownFor.current = null;
      pagesShown.current = 0;
      setState({ ...EMPTY_STATE, loading: true });
    }
    const load = async () => {
      try {
        const call = { name: TOOL_NAME, arguments: buildArgs(def, semantic, true).args };
        const [outcome] = await callTools(invoke, [call]);
        if (requestId.current !== id) return;
        if (!outcome?.ok) throw new Error(outcome?.error ?? "Loading overnight transactions failed.");
        const page = parseOvernightPage(outcome.result);
        if (page.error) throw new Error(page.error);
        savingsAccountId.current = page.savingsAccountId ?? savingsAccountId.current;
        const deeper = inPlace && pagesShown.current > 1;
        if (!inPlace) pagesShown.current = 1;
        shownFor.current = filterKey;
        setState((current) => ({
          rows: inPlace ? appendPage(page.transactions, current.rows) : page.transactions,
          account: page.account ?? (inPlace ? current.account : null),
          total: page.total,
          // With more pages loaded, "Load more" carries on after the last of them.
          nextCursor: deeper ? current.nextCursor : page.nextCursor,
          loading: false,
          error: null,
        }));
      } catch (error) {
        if (requestId.current !== id) return;
        if (inPlace) setState((current) => ({ ...current, loading: false, error: errorMessage(error) }));
        else setState({ ...EMPTY_STATE, error: errorMessage(error) });
      }
    };
    void load();
    return () => {
      if (requestId.current === id) requestId.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offered, defKey, invoke, reloadKey, filters.searchTerm, filters.type, filters.period, pageSize]);

  const loadMore = useCallback(async () => {
    if (!state.nextCursor || state.loading || !def) return;
    const id = requestId.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const semantic = { ...requestBase.current, cursor: state.nextCursor, savingsAccountId: savingsAccountId.current };
      const call = { name: TOOL_NAME, arguments: buildArgs(def, semantic, true).args };
      const [outcome] = await callTools(invoke, [call]);
      if (requestId.current !== id) return;
      if (!outcome?.ok) throw new Error(outcome?.error ?? "Loading more overnight transactions failed.");
      const page = parseOvernightPage(outcome.result);
      if (page.error) throw new Error(page.error);
      if (page.savingsAccountId) savingsAccountId.current = page.savingsAccountId;
      pagesShown.current += 1;
      setState((current) => ({
        ...current,
        rows: appendPage(current.rows, page.transactions),
        account: page.account ?? current.account,
        total: page.total,
        nextCursor: page.nextCursor,
        loading: false,
        error: null,
      }));
    } catch (error) {
      if (requestId.current === id) setState((current) => ({ ...current, loading: false, error: errorMessage(error) }));
    }
  }, [def, invoke, state.loading, state.nextCursor]);

  return { ...state, loadMore };
}
