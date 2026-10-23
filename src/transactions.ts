import { pick, pickString, type Rec } from "./response";

export type TransactionRow = { record: Rec; portfolioId: string };

/** Whether a transaction is an order that has not been executed, cancelled or rejected yet. */
export function isOpenOrder(record: Rec): boolean {
  const status = pickString(record, ["status", "state", "orderStatus"]) ?? "";
  return /pending|open|active|queued|working|accepted|placed|new/i.test(status) && !/cancel|reject|exec|fill|settled|complete|expired/i.test(status);
}

/** The ISIN a transaction is about, or null for cash movements and crypto. */
export function transactionIsin(record: Rec): string | null {
  return pickString(pick(record, ["security"]), ["isin"]) ?? pickString(record, ["isin"]) ?? null;
}

/** Identity of a transaction across reloads, or null when the record has no id. */
function transactionKey(row: TransactionRow): string | null {
  const id = pickString(row.record, ["transactionId", "id", "orderId"]);
  return id ? `${row.portfolioId}:${id}` : null;
}

/** The rows in order, each transaction once (the first occurrence wins). Rows without an id are always kept. */
export function dedupeRows(rows: TransactionRow[]): TransactionRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = transactionKey(row);
    if (key === null) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The rows newest first. Rows without a readable date keep their order and go last. */
export function newestFirst(rows: TransactionRow[]): TransactionRow[] {
  const timeOf = (row: TransactionRow): number => {
    const text = pickString(row.record, ["lastEventAt", "date", "timestamp", "timestampUtc", "createdAt", "executedAt"]);
    const time = text ? Date.parse(text) : Number.NaN;
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
  };
  return rows
    .map((row, index) => ({ row, index, time: timeOf(row) }))
    .sort((a, b) => (a.time === b.time ? a.index - b.index : b.time > a.time ? 1 : -1))
    .map((entry) => entry.row);
}

export type TransactionFilter = { text: string; kind: string; status: string };

export const NO_FILTER: TransactionFilter = { text: "", kind: "", status: "" };

export function isFiltering(filter: TransactionFilter): boolean {
  return filter.text.trim() !== "" || filter.kind !== "" || filter.status !== "";
}

/** Whether a transaction passes the filter: `text` matches the symbol (ISIN) or name, `kind` and `status` match exactly (ignoring case). */
export function matchesFilter(fields: { kind: string; status?: string; isin?: string; name?: string }, filter: TransactionFilter): boolean {
  if (filter.kind !== "" && fields.kind.toLowerCase() !== filter.kind.toLowerCase()) return false;
  if (filter.status !== "" && (fields.status ?? "").toLowerCase() !== filter.status.toLowerCase()) return false;
  const text = filter.text.trim().toLowerCase();
  if (text === "") return true;
  return [fields.isin, fields.name].some((value) => value?.toLowerCase().includes(text));
}

/** The distinct non-empty values, one per spelling ignoring case, sorted. */
export function distinctValues(values: (string | undefined)[]): string[] {
  const byLower = new Map<string, string>();
  for (const value of values) if (value && !byLower.has(value.toLowerCase())) byLower.set(value.toLowerCase(), value);
  return [...byLower.values()].sort((a, b) => a.localeCompare(b));
}
