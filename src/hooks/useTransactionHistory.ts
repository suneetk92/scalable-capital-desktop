import { useEffect, useState } from "react";
import { clearHistories, historyGeneration, historyRows, loadHistory, parsePage, saveHistory, syncHistory, type CachedHistory, type SyncProgress } from "../activityCache";
import { buildArgs, callTools } from "../tools";
import { pickString, type Rec } from "../response";
import type { TransactionRow } from "../transactions";
import type { Common } from "../types";
import { TOOL } from "../commands";

/** The tool's largest `pageSize`. */
const PAGE_SIZE = 100;

type Running = { promise: Promise<CachedHistory>; progress: SyncProgress; listeners: Set<() => void>; generation: number };
// A sync keeps running when the Overview is left or reloaded, and the next caller joins it instead of starting another.
const running = new Map<string, Running>();
// The last complete load, so opening the Overview again does not sync again until the dashboard reloads or the history is cleared.
let synced: { key: string; state: Omit<TransactionHistory, "reloadAll"> } | null = null;

const cancelListeners = new Set<(portfolioId: string, ids: string[]) => void>();

const CANCELLED = "CANCELLED";

const hasAnyId = (record: Rec, ids: string[]) => ids.some((id) => ["id", "transactionId", "orderId"].some((key) => pickString(record, [key]) === id));

function cancelledIn(rows: TransactionRow[], portfolioId: string, ids: string[]): TransactionRow[] {
  return rows.map((row) => (row.portfolioId === portfolioId && hasAnyId(row.record, ids) ? { ...row, record: { ...row.record, status: CANCELLED } } : row));
}

/**
 * Marks a transaction as cancelled in the stored history and in every view showing it, without reading the
 * history again. Used after Scalable confirmed the cancellation of an open order.
 */
export function markCancelled(portfolioId: string, ids: (string | undefined)[]) {
  const wanted = ids.filter((id): id is string => id !== undefined && id !== "");
  if (wanted.length === 0) return;
  void loadHistory(portfolioId).then((stored) => {
    if (stored) void saveHistory(portfolioId, { ...stored, records: stored.records.map((record) => (hasAnyId(record, wanted) ? { ...record, status: CANCELLED } : record)) });
  });
  if (synced) synced = { ...synced, state: { ...synced.state, rows: cancelledIn(synced.state.rows, portfolioId, wanted) } };
  cancelListeners.forEach((listener) => listener(portfolioId, wanted));
}

type TransactionHistory = {
  rows: TransactionRow[];
  loading: boolean;
  /** Transactions loaded so far and the total Scalable reports, while a full load is running. */
  progress: SyncProgress | null;
  error: string | null;
  /** When the stored history was last brought up to date. */
  syncedAt: number | null;
  /** Forgets the stored history and loads everything again. */
  reloadAll: () => void;
};

/**
 * Every transaction of every portfolio. The first load reads all pages (100 each, newest first) and stores them
 * (IndexedDB, at most `MAX_STORED_PER_PORTFOLIO` per portfolio); later loads show the stored history first and
 * only fetch what is new since.
 */
export function useTransactionHistory(common: Pick<Common, "invoke" | "defs" | "portfolios" | "reloadKey" | "actions">): TransactionHistory {
  const { invoke, defs, portfolios, reloadKey, actions } = common;
  const offered = actions.has(TOOL.listPortfolioTransactions);
  const ids = portfolios.map((portfolio) => portfolio.portfolioId).filter((id) => id !== "");
  const idsKey = ids.join("|");
  const def = defs.find((item) => item.name === TOOL.listPortfolioTransactions);
  const defKey = def ? JSON.stringify(def) : "";
  const [forced, setForced] = useState(0);
  const [state, setState] = useState<Omit<TransactionHistory, "reloadAll">>({ rows: [], loading: false, progress: null, error: null, syncedAt: null });

  useEffect(() => {
    if (!offered || ids.length === 0) {
      setState({ rows: [], loading: false, progress: null, error: null, syncedAt: null });
      return;
    }
    if (!def) {
      setState((current) => ({ ...current, loading: false, progress: null }));
      return;
    }
    const syncKey = `${idsKey}|${reloadKey}|${historyGeneration()}`;
    if (synced?.key === syncKey) {
      setState(synced.state);
      return;
    }
    let active = true;
    const entryGeneration = historyGeneration();
    let stored = new Map<string, CachedHistory | null>();
    const rowsOf = (histories: Map<string, CachedHistory | null>) =>
      ids.flatMap((id) => {
        const history = histories.get(id);
        return history ? historyRows(id, history) : [];
      });
    const syncedOf = (histories: Map<string, CachedHistory | null>) => {
      const times = ids.map((id) => {
        const history = histories.get(id);
        return history?.resume ? undefined : history?.syncedAt;
      });
      return times.every((time): time is number => time !== undefined) ? Math.min(...times) : null;
    };

    const progressOf = () => {
      const entries = ids.map((id) => running.get(id)?.progress).filter((entry): entry is SyncProgress => entry !== undefined);
      const totals = entries.map((entry) => entry.total);
      return entries.length === 0
        ? null
        : { loaded: entries.reduce((sum, entry) => sum + entry.loaded, 0), total: totals.every((total) => total !== null) ? totals.reduce<number>((sum, total) => sum + (total ?? 0), 0) : null };
    };
    const onProgress = () => {
      if (active) setState((current) => ({ ...current, progress: progressOf() }));
    };

    const syncOne = (id: string): Promise<CachedHistory> => {
      const existing = running.get(id);
      if (existing && existing.generation === historyGeneration()) {
        existing.listeners.add(onProgress);
        return existing.promise;
      }
      const entry: Running = {
        promise: Promise.resolve({ syncedAt: 0, records: [] }),
        progress: { loaded: stored.get(id)?.records.length ?? 0, total: null },
        listeners: new Set([onProgress]),
        generation: historyGeneration(),
      };
      entry.promise = syncHistory(
        async (request) => {
          const call = { name: TOOL.listPortfolioTransactions, arguments: buildArgs(def, { portfolioId: id, pageSize: PAGE_SIZE, ...request }, true).args };
          const [outcome] = await callTools(invoke, [call]);
          if (!outcome?.ok) throw new Error(outcome?.error ?? "Loading the transactions failed.");
          return parsePage(outcome.result);
        },
        stored.get(id) ?? null,
        (progress) => {
          entry.progress = progress;
          entry.listeners.forEach((listener) => listener());
        },
        (partial) => {
          if (entry.generation === historyGeneration()) void saveHistory(id, partial);
        },
      )
        .then((history) => {
          // A clear from Settings while this ran makes the result stale: show it, but do not store it.
          if (entry.generation === historyGeneration()) void saveHistory(id, history);
          return history;
        })
        .finally(() => {
          if (running.get(id) === entry) running.delete(id);
        });
      running.set(id, entry);
      return entry.promise;
    };

    setState((current) => ({ ...current, loading: true, progress: null, error: null }));
    void Promise.all(ids.map((id) => loadHistory(id))).then((loaded) => {
      if (!active) return;
      stored = new Map(ids.map((id, index) => [id, loaded[index] ?? null]));
      setState({ rows: rowsOf(stored), loading: true, progress: null, error: null, syncedAt: syncedOf(stored) });
      return Promise.allSettled(ids.map(syncOne)).then((results) => {
        if (!active) return;
        const histories = new Map<string, CachedHistory | null>();
        const failures: string[] = [];
        results.forEach((result, index) => {
          const id = ids[index] ?? "";
          if (result.status === "fulfilled") histories.set(id, result.value);
          else {
            histories.set(id, stored.get(id) ?? null);
            failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
          }
        });
        const done = { rows: rowsOf(histories), loading: false, progress: null, error: failures[0] ?? null, syncedAt: failures.length > 0 ? null : syncedOf(histories) };
        if (failures.length === 0 && entryGeneration === historyGeneration()) synced = { key: syncKey, state: done };
        setState(done);
      });
    });
    return () => {
      active = false;
      ids.forEach((id) => running.get(id)?.listeners.delete(onProgress));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offered, idsKey, reloadKey, forced, invoke, defKey]);

  useEffect(() => {
    const listener = (portfolioId: string, ids: string[]) => setState((current) => ({ ...current, rows: cancelledIn(current.rows, portfolioId, ids) }));
    cancelListeners.add(listener);
    return () => {
      cancelListeners.delete(listener);
    };
  }, []);

  const reloadAll = () => {
    if (running.size > 0) return;
    clearHistories();
    setForced((count) => count + 1);
  };
  return { ...state, reloadAll };
}
