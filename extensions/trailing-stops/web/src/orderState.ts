import { useEffect, useMemo, useState } from "react";
import { isRec, parseMaybeJson, pickString, type Rec } from "../../../../src/response";
import { useToolQuery } from "../../../../src/toolActions";
import type { Common } from "../../../../src/types";
import { humanize } from "../../../../src/tools";
import type { TrailingStop } from "./trailing";

const FINAL_KEY = "scalable-capital-desktop.trailing-order-final-2";
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

/**
 * The state of the order in a `get_transaction_details` answer: the finalisation reason (FILLED, ...) once Scalable
 * has set one, else the trade status, else the latest history entry. It is final when there is a reason or the status cannot change.
 */
export function orderStateOf(result: unknown): { state: string; final: boolean } | null {
  const transaction = transactionIn(result);
  if (!transaction) return null;
  const trade = isRec(transaction.securityTrade) ? transaction.securityTrade : undefined;
  const reason = trade ? pickString(trade, ["finalisationReason"]) : undefined;
  const status = trade ? pickString(trade, ["status"]) : undefined;
  if (reason) return { state: reason, final: true };
  if (status) return { state: status, final: isFinalState(status) };
  const history = Array.isArray(transaction.history) ? transaction.history.filter(isRec) : [];
  const last = history.length > 0 ? pickString(history[history.length - 1], ["state"]) : undefined;
  return last ? { state: last, final: isFinalState(last) } : null;
}

export const orderStateLabel = (state: string) => humanize(state.toLowerCase());

function loadFinals(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FINAL_KEY) ?? "{}");
    return isRec(parsed) ? Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
  } catch {
    return {};
  }
}

/**
 * Where each placed order stands at Scalable (submitted, filled, settled, ...), by stop id. It is asked for on
 * every refresh until the order reaches a final state; that state is remembered and the order is not asked about again.
 */
export function useOrderStates(common: Common, stops: TrailingStop[]): ReadonlyMap<string, string> {
  const [finals, setFinals] = useState(loadFinals);
  const pending = useMemo(
    () =>
      stops.flatMap((stop) => {
        const orderId = orderIdOf(stop.receipt);
        return stop.status === "sold" && orderId && !finals[stop.id] ? [{ stopId: stop.id, orderId, portfolioId: stop.portfolioId }] : [];
      }),
    [stops, finals],
  );
  const argsList = useMemo<Rec[] | null>(
    () =>
      pending.length > 0 && common.actions.has("get_transaction_details")
        ? pending.map((item) => ({ transactionId: item.orderId, ...(item.portfolioId ? { portfolioId: item.portfolioId } : {}) }))
        : null,
    [pending, common.actions],
  );
  const query = useToolQuery(common.invoke, common.defs, "get_transaction_details", argsList, common.reloadKey);
  const latest = useMemo(() => {
    const byOrder = new Map<string, { state: string; final: boolean }>();
    for (const entry of query.entries) {
      const id = pickString(entry.semantic, ["transactionId"]);
      const found = entry.outcome.ok ? orderStateOf(entry.outcome.result) : null;
      if (id && found) byOrder.set(id, found);
    }
    return pending.flatMap((item) => {
      const found = byOrder.get(item.orderId);
      return found ? [{ stopId: item.stopId, ...found }] : [];
    });
  }, [query.entries, pending]);

  useEffect(() => {
    const done = latest.filter((item) => item.final).map((item) => [item.stopId, item.state] as const);
    if (done.length === 0) return;
    setFinals((current) => {
      const next = { ...current, ...Object.fromEntries(done) };
      try {
        localStorage.setItem(FINAL_KEY, JSON.stringify(next));
      } catch {
        // Not remembered: the order is asked about again next time.
      }
      return next;
    });
  }, [latest]);

  return useMemo(() => new Map([...Object.entries(finals), ...latest.map((item) => [item.stopId, item.state] as const)]), [finals, latest]);
}
