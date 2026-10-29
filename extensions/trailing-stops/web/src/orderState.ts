import { useEffect, useMemo, useState } from "react";
import { isRec, parseMaybeJson, pickString, type Rec } from "../../../../src/response";
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
export type OrderInfo = { state: string; final: boolean; history: OrderStep[] };

/**
 * The order in a `get_transaction_details` answer. Its state is the finalisation reason (FILLED, ...) once Scalable
 * has set one, else the trade status, else the latest history entry; it is final when there is a reason or the state cannot change.
 */
export function orderStateOf(result: unknown): OrderInfo | null {
  const transaction = transactionIn(result);
  if (!transaction) return null;
  const trade = isRec(transaction.securityTrade) ? transaction.securityTrade : undefined;
  const reason = trade ? pickString(trade, ["finalisationReason"]) : undefined;
  const status = trade ? pickString(trade, ["status"]) : undefined;
  const history = (Array.isArray(transaction.history) ? transaction.history.filter(isRec) : []).flatMap((entry) => {
    const state = pickString(entry, ["state"]);
    return state ? [{ state, timestamp: pickString(entry, ["timestamp"]) ?? null }] : [];
  });
  const last = history.length > 0 ? history[history.length - 1].state : undefined;
  const state = reason ?? status ?? last;
  return state ? { state, final: reason !== undefined || isFinalState(state), history } : null;
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
 * with its time, by stop id. It is asked for on every refresh until the order is final; then it is kept and not asked about again.
 */
export function useOrderStates(common: Common, stops: TrailingStop[]): ReadonlyMap<string, OrderInfo> {
  const [known, setKnown] = useState(loadKnown);
  const pending = useMemo(
    () =>
      stops.flatMap((stop) => {
        const orderId = orderIdOf(stop.receipt);
        return stop.status === "sold" && orderId && !known[stop.id]?.final ? [{ stopId: stop.id, orderId, portfolioId: stop.portfolioId }] : [];
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
        const merged = { ...found, history: mergeSteps(current[stopId]?.history ?? [], found.history) };
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
