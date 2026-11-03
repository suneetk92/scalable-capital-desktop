import { useEffect, useMemo, useState } from "react";
import { finiteNumber, isRec, parseMaybeJson, pickNumber, pickString, type Rec } from "../../../../src/response";
import { useToolQuery } from "../../../../src/toolActions";
import type { Common } from "../../../../src/types";
import { humanize } from "../../../../src/tools";
import type { TrailingStop } from "./trailing";

const KNOWN_KEY = "scalable-capital-desktop.trailing-order-states";
/** States Scalable does not move on from, so the order is not asked about again. */
const FINAL_STATE = /settled|cancel|reject|expire|fail/i;

export const isFinalState = (state: string) => FINAL_STATE.test(state);

/** The order id Scalable returned when the stop placed its order. */
export function orderIdOf(receipt: unknown): string | undefined {
  return isRec(receipt) ? pickString(receipt, ["orderId"]) : undefined;
}

function transactionIn(value: unknown, depth = 0): Rec | undefined {
  const parsed = parseMaybeJson(value);
  if (!isRec(parsed) || depth > 3) return undefined;
  if (isRec(parsed.transaction)) return parsed.transaction;
  if (isRec(parsed.securityTrade) || Array.isArray(parsed.history)) return parsed;
  return Object.values(parsed)
    .map((child) => transactionIn(child, depth + 1))
    .find((found) => found !== undefined);
}

type OrderStep = { state: string; timestamp: string | null };
export type OrderInfo = {
  state: string;
  final: boolean;
  history: OrderStep[];
  executionPrice: number | null;
  executionTime: string | null;
  currency: string | null;
  executionChecked: boolean;
};

function dateTime(value: string | undefined): string | null {
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

function latestExecution(history: Rec[]): { price: number | null; timestamp: string | null } | undefined {
  const executions = history.flatMap((entry) => {
    const price = pickNumber(entry, ["executionPrice"]);
    const timestamp = dateTime(pickString(entry, ["timestamp"]));
    const state = pickString(entry, ["state"]);
    return price !== null || (timestamp !== null && state !== undefined && /fill|execut|trade/i.test(state)) ? [{ price, timestamp }] : [];
  });
  return executions.reduce<(typeof executions)[number] | undefined>((latest, candidate) => {
    if (!latest) return candidate;
    const latestTime = latest.timestamp ? Date.parse(latest.timestamp) : Number.NaN;
    const candidateTime = candidate.timestamp ? Date.parse(candidate.timestamp) : Number.NaN;
    if (Number.isFinite(candidateTime) && (!Number.isFinite(latestTime) || candidateTime >= latestTime)) return candidate;
    if (!Number.isFinite(candidateTime) && !Number.isFinite(latestTime)) return candidate;
    return latest;
  }, undefined);
}

/**
 * The order in a `get_transaction_details` answer. Its state is the finalisation reason (FILLED, ...) once Scalable
 * has set one, else the trade status, the latest history entry or `unknown`; it is final when there is a reason or the state cannot change.
 */
export function orderStateOf(result: unknown): OrderInfo | null {
  const transaction = transactionIn(result);
  if (!transaction) return null;
  const trade = isRec(transaction.securityTrade) ? transaction.securityTrade : undefined;
  const reason = trade ? pickString(trade, ["finalisationReason"]) : undefined;
  const status = trade ? pickString(trade, ["status"]) : undefined;
  const rawHistory = Array.isArray(transaction.history) ? transaction.history.filter(isRec) : [];
  const history = rawHistory.flatMap((entry) => {
    const state = pickString(entry, ["state"]);
    return state ? [{ state, timestamp: pickString(entry, ["timestamp"]) ?? null }] : [];
  });
  const last = history.length > 0 ? history[history.length - 1].state : undefined;
  const state = reason ?? status ?? last ?? "unknown";
  const latest = latestExecution(rawHistory);
  return {
    state,
    final: reason !== undefined || isFinalState(state),
    history,
    executionPrice: latest?.price ?? (trade ? pickNumber(trade, ["executionPrice", "averagePrice"]) : null),
    executionTime: latest?.timestamp ?? (trade ? dateTime(pickString(trade, ["executionDate"])) : null),
    currency: pickString(transaction, ["currency"]) ?? null,
    executionChecked: true,
  };
}

/** Every state seen so far, oldest first, without repeating one the app already recorded. */
function mergeSteps(known: OrderStep[], fresh: OrderStep[]): OrderStep[] {
  const seen = new Set(known.map((step) => `${step.state}|${step.timestamp}`));
  return [...known, ...fresh.filter((step) => !seen.has(`${step.state}|${step.timestamp}`))].sort((a, b) => Date.parse(a.timestamp ?? "") - Date.parse(b.timestamp ?? "") || 0);
}

export const orderStateLabel = (state: string) => humanize(state.toLowerCase());

function loadKnown(): Record<string, OrderInfo> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KNOWN_KEY) ?? "{}");
    if (!isRec(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([id, value]) =>
        isRec(value) && typeof value.state === "string" && Array.isArray(value.history)
          ? [
              [
                id,
                {
                  state: value.state,
                  final: value.final === true,
                  history: value.history
                    .filter(isRec)
                    .flatMap((step) => (typeof step.state === "string" ? [{ state: step.state, timestamp: typeof step.timestamp === "string" ? step.timestamp : null }] : [])),
                  executionPrice: finiteNumber(value.executionPrice),
                  executionTime: dateTime(typeof value.executionTime === "string" ? value.executionTime : undefined),
                  currency: typeof value.currency === "string" ? value.currency : null,
                  executionChecked: value.executionChecked === true,
                },
              ],
            ]
          : [],
      ),
    );
  } catch {
    return {};
  }
}

/**
 * Where each placed order stands at Scalable (submitted, filled, settled, ...) and every state it went through
 * with its time, by stop id. It is asked for on every refresh until the order is final; older final records are fetched once for execution data.
 */
export function useOrderStates(common: Common, stops: TrailingStop[]): ReadonlyMap<string, OrderInfo> {
  const [known, setKnown] = useState(loadKnown);
  const pending = useMemo(
    () =>
      stops.flatMap((stop) => {
        const orderId = orderIdOf(stop.receipt);
        const order = known[stop.id];
        return stop.status === "sold" && orderId && (!order?.final || !order.executionChecked) ? [{ stopId: stop.id, orderId, portfolioId: stop.portfolioId }] : [];
      }),
    [stops, known],
  );
  const argsList = useMemo<Rec[] | null>(
    () =>
      pending.length > 0 && common.actions.has("get_transaction_details")
        ? pending.map((item) => ({ transactionId: item.orderId, ...(item.portfolioId ? { portfolioId: item.portfolioId } : {}) }))
        : null,
    [pending, common.actions],
  );
  const query = useToolQuery(common.invoke, common.defs, "get_transaction_details", argsList, common.reloadKey);

  useEffect(() => {
    const byOrder = new Map<string, OrderInfo>();
    for (const entry of query.entries) {
      const id = pickString(entry.semantic, ["transactionId"]);
      const found = entry.outcome.ok ? orderStateOf(entry.outcome.result) : null;
      if (id && found) byOrder.set(id, found);
    }
    const changes = pending.flatMap((item) => {
      const found = byOrder.get(item.orderId);
      return found ? [[item.stopId, found] as const] : [];
    });
    if (changes.length === 0) return;
    setKnown((current) => {
      let changed = false;
      const next = { ...current };
      for (const [stopId, found] of changes) {
        const previous = current[stopId];
        const hasFreshExecution = found.executionPrice !== null || found.executionTime !== null;
        const merged = {
          ...found,
          state: found.state === "unknown" ? (previous?.state ?? found.state) : found.state,
          final: found.final || previous?.final === true,
          executionPrice: hasFreshExecution ? found.executionPrice : (previous?.executionPrice ?? null),
          executionTime: hasFreshExecution ? found.executionTime : (previous?.executionTime ?? null),
          currency: found.currency ?? previous?.currency ?? null,
          executionChecked: true,
          history: mergeSteps(previous?.history ?? [], found.history),
        };
        if (JSON.stringify(merged) !== JSON.stringify(current[stopId])) {
          next[stopId] = merged;
          changed = true;
        }
      }
      if (!changed) return current;
      try {
        localStorage.setItem(KNOWN_KEY, JSON.stringify(next));
      } catch {
        // Not remembered: the order is asked about again next time.
      }
      return next;
    });
  }, [query.entries, pending]);

  return useMemo(() => new Map(Object.entries(known)), [known]);
}
