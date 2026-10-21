import { decimalNumber, isRec, parseMaybeJson, pick, pickString, recordsOf, type Rec } from "./response";

export const OVERNIGHT_TYPES = [
  { value: "all", label: "All types", transactionTypes: [] },
  { value: "interest", label: "Interest", transactionTypes: ["interest"] },
  { value: "deposit", label: "Deposits", transactionTypes: ["deposit"] },
  { value: "withdrawal", label: "Withdrawals", transactionTypes: ["withdrawal"] },
] as const;

export type OvernightType = (typeof OVERNIGHT_TYPES)[number]["value"];

export const OVERNIGHT_PERIODS = [
  { value: "all", label: "All time" },
  { value: "7d", label: "7 days", days: 7 },
  { value: "30d", label: "30 days", days: 30 },
  { value: "90d", label: "90 days", days: 90 },
  { value: "1y", label: "1 year", days: 365 },
] as const;

export type OvernightPeriod = (typeof OVERNIGHT_PERIODS)[number]["value"];

export type OvernightAccount = { displayName: string; ownerKind: "personal" | "junior"; isActive: boolean };
type OvernightDocument = { id: string | null; label: string | null; url: string };
export type OvernightTransaction = {
  id: string;
  when: string | null;
  kind: string;
  status: string | null;
  description: string | null;
  amount: number | null;
  currency: string | null;
  cancellation: boolean | null;
  documents: OvernightDocument[];
};

type OvernightPage = {
  account: OvernightAccount | null;
  savingsAccountId: string | null;
  transactions: OvernightTransaction[];
  nextCursor: string | null;
  total: number;
  error: string | null;
};

function secureUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function accountOf(value: unknown): OvernightAccount | null {
  if (!isRec(value)) return null;
  const displayName = pickString(value, ["displayName"]);
  const ownerKind = pickString(value, ["ownerKind"]);
  const isActive = pick(value, ["isActive"]);
  if (!displayName || (ownerKind !== "personal" && ownerKind !== "junior") || typeof isActive !== "boolean") return null;
  return { displayName, ownerKind, isActive };
}

function documentList(value: unknown): OvernightDocument[] {
  return recordsOf(value)
    .map((record) => ({ id: pickString(record, ["id"]) ?? null, label: pickString(record, ["label"]) ?? null, url: secureUrl(pick(record, ["url"])) }))
    .filter((document): document is OvernightDocument => document.url !== null);
}

function transactionOf(record: Rec): OvernightTransaction | null {
  const id = pickString(record, ["id"]);
  if (!id) return null;
  const cancellation = pick(record, ["isCancellation"]);
  return {
    id,
    when: pickString(record, ["lastEventAt"]) ?? null,
    kind: pickString(record, ["cashTransactionType"]) ?? pickString(record, ["type"]) ?? "",
    status: pickString(record, ["status"]) ?? null,
    description: pickString(record, ["description"]) ?? null,
    amount: decimalNumber(pick(record, ["amount"])),
    currency: pickString(record, ["currency"]) ?? null,
    cancellation: typeof cancellation === "boolean" ? cancellation : null,
    documents: documentList(pick(record, ["documents"])),
  };
}

function countOf(value: unknown): number {
  const count = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

/** Reads the published overnight page shape defensively; malformed rows and non-HTTPS document links are ignored. */
export function parseOvernightPage(value: unknown): OvernightPage {
  const parsed = parseMaybeJson(value);
  const result = isRec(parsed) ? parsed : {};
  const page = pick(result, ["page"]);
  const error = pickString(pick(result, ["error"]), ["message"]);
  return {
    account: accountOf(pick(result, ["account"])),
    savingsAccountId: pickString(result, ["savingsAccountId"]) ?? null,
    transactions: recordsOf(pick(result, ["transactions"]))
      .map(transactionOf)
      .filter((transaction): transaction is OvernightTransaction => transaction !== null),
    nextCursor: pickString(page, ["nextCursor"]) ?? null,
    total: countOf(pick(page, ["totalCount"])),
    error: error ?? null,
  };
}

export function periodStart(period: OvernightPeriod, now = new Date()): string | undefined {
  const selected = OVERNIGHT_PERIODS.find((item) => item.value === period);
  if (!selected || !("days" in selected) || Number.isNaN(now.getTime())) return undefined;
  return new Date(now.getTime() - selected.days * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function overnightRequest(
  filters: {
    searchTerm?: string;
    type?: OvernightType;
    period?: OvernightPeriod;
    cursor?: string;
    pageSize?: number;
    savingsAccountId?: string;
  },
  now = new Date(),
): Record<string, unknown> {
  const request: Record<string, unknown> = {};
  const searchTerm = filters.searchTerm?.trim();
  if (searchTerm) request.searchTerm = searchTerm;
  if (filters.cursor) request.cursor = filters.cursor;
  if (filters.savingsAccountId) request.savingsAccountId = filters.savingsAccountId;
  if (typeof filters.pageSize === "number" && Number.isFinite(filters.pageSize)) request.pageSize = Math.min(100, Math.max(1, Math.floor(filters.pageSize)));
  const fromTime = periodStart(filters.period ?? "all", now);
  if (fromTime) request.fromTime = fromTime;
  const selected = OVERNIGHT_TYPES.find((item) => item.value === (filters.type ?? "all"));
  if (selected && selected.transactionTypes.length > 0) request.transactionTypes = [...selected.transactionTypes];
  return request;
}

export function appendPage(existing: OvernightTransaction[], incoming: OvernightTransaction[]): OvernightTransaction[] {
  const rows = [...existing];
  const ids = new Set(existing.map((row) => row.id));
  for (const row of incoming) {
    if (!ids.has(row.id)) {
      ids.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}
