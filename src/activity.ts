import { humanize } from "./tools";
import { decimalNumber, pick, pickString, type Rec } from "./response";
import { dedupeRows, isOpenOrder, transactionIsin, type TransactionRow } from "./transactions";

type SecurityActivity = {
  isin: string;
  name: string;
  boughtQuantity: number;
  boughtAmount: number;
  soldQuantity: number;
  soldAmount: number;
  fees: number;
  dividends: number;
  /** Average buy price over the loaded buys, or null when none were loaded. */
  averageBuyPrice: number | null;
  /** Sale proceeds minus the average cost of the shares sold; null when nothing was sold or no buy was loaded. */
  realised: number | null;
};

/** Transactions left out of the totals, with why: an unrecognised type, or an order that is open, cancelled or rejected. */
type IgnoredActivity = { label: string; count: number };

type ActivitySummary = {
  currency: string;
  /** Every transaction, each once. */
  total: number;
  /** The transactions that went into the totals. */
  counted: number;
  ignored: IgnoredActivity[];
  bought: number;
  sold: number;
  netInvested: number;
  fees: number;
  taxes: number;
  dividends: number;
  interest: number;
  deposits: number;
  withdrawals: number;
  netDeposits: number;
  securities: SecurityActivity[];
};

/** The parts of a transaction record that hold its figures, as in the output schema of `list_portfolio_transactions`. */
const PARTS = ["security", "cash", "nonTradeSecurity", "eltif"];

/** The first number found under `name` in the record (crypto rows keep it there), then in its security, cash, non-trade and fund parts. */
function numberOf(record: Rec, name: string): number | null {
  for (const source of [record, ...PARTS.map((part) => pick(record, [part]))]) {
    const value = decimalNumber(pick(source, [name]));
    if (value !== null) return value;
  }
  return null;
}

function stringOf(record: Rec, name: string): string | undefined {
  for (const source of [record, ...PARTS.map((part) => pick(record, [part]))]) {
    const value = pickString(source, [name]);
    if (value) return value;
  }
  return undefined;
}

type ActivityType = "fee" | "tax" | "dividend" | "interest" | "deposit" | "withdrawal" | "buy" | "sell";

function classify(kind: string): ActivityType | null {
  if (/fee|commission/.test(kind)) return "fee";
  if (/tax|withholding|vorabpauschale/.test(kind)) return "tax";
  if (/dividend|distribution|payout/.test(kind)) return "dividend";
  if (/interest|coupon/.test(kind)) return "interest";
  if (/deposit|top.?up|transfer.?in/.test(kind)) return "deposit";
  if (/withdraw|transfer.?out/.test(kind)) return "withdrawal";
  if (/buy|purchase|swap.?in/.test(kind)) return "buy";
  if (/sell|sale|swap.?out/.test(kind)) return "sell";
  return null;
}

/** The type of a transaction: the first of its side, transaction type and category that is recognised. */
function typeOf(record: Rec): ActivityType | null {
  for (const name of ["side", "transactionType", "type", "category"]) {
    const type = classify((stringOf(record, name) ?? "").toLowerCase());
    if (type !== null) return type;
  }
  return null;
}

/** Whether the transaction really moved money: not an open order, a cancellation, or cancelled, rejected or expired. */
function isExecuted(record: Rec): boolean {
  const status = pickString(record, ["status", "state", "orderStatus"]) ?? "";
  return record.isCancellation !== true && !isOpenOrder(record) && !/cancel|reject|expired|fail/i.test(status);
}

/**
 * Sums the transactions into totals and a per-security breakdown. Transactions carry no separate fee, tax or
 * price field, so fees and taxes are the fee and tax cash transactions, and the average buy price is the bought
 * amount over the bought quantity. Buys and sells are taken by size, and a swap in counts as a buy and a swap
 * out as a sell. Cash transactions keep their sign (money in
 * is positive), so a refunded fee, a tax return or a withheld-tax correction on a dividend lowers its total, and
 * interest is negative when it was charged. Open, cancelled and rejected orders and types that are not recognised
 * are left out. The realised result uses the average buy price of the loaded buys.
 */
export function summarizeActivity(rows: TransactionRow[], fallbackCurrency = "EUR"): ActivitySummary {
  const summary: ActivitySummary = {
    currency: fallbackCurrency,
    total: 0,
    counted: 0,
    ignored: [],
    bought: 0,
    sold: 0,
    netInvested: 0,
    fees: 0,
    taxes: 0,
    dividends: 0,
    interest: 0,
    deposits: 0,
    withdrawals: 0,
    netDeposits: 0,
    securities: [],
  };
  const bySecurity = new Map<string, SecurityActivity>();
  const ignored = new Map<string, number>();
  const ignore = (label: string) => ignored.set(label, (ignored.get(label) ?? 0) + 1);
  let currencySet = false;

  for (const { record } of dedupeRows(rows)) {
    summary.total += 1;
    const type = typeOf(record);
    if (type === null) {
      const raw = ["side", "transactionType", "type", "category", "kind"].map((name) => stringOf(record, name)).find(Boolean);
      ignore(raw ? humanize(raw) : "Unknown type");
      continue;
    }
    if (!isExecuted(record)) {
      ignore("Open, cancelled or rejected orders");
      continue;
    }
    const quantity = Math.abs(numberOf(record, "quantity") ?? 0);
    const signedAmount = numberOf(record, "amount") ?? 0;
    const amount = Math.abs(signedAmount);
    const isin = transactionIsin(record) ?? stringOf(record, "relatedIsin") ?? stringOf(record, "isin") ?? "";

    if (!currencySet) {
      const currency = pickString(record, ["currency"]);
      if (currency) {
        summary.currency = currency;
        currencySet = true;
      }
    }
    summary.counted += 1;

    let security: SecurityActivity | undefined;
    if (isin) {
      security = bySecurity.get(isin) ?? { isin, name: "", boughtQuantity: 0, boughtAmount: 0, soldQuantity: 0, soldAmount: 0, fees: 0, dividends: 0, averageBuyPrice: null, realised: null };
      security.name ||= pickString(pick(record, ["security"]), ["name", "securityName"]) ?? pickString(record, ["name", "securityName", "title"]) ?? "";
      bySecurity.set(isin, security);
    }

    if (type === "buy") {
      summary.bought += amount;
      if (security) {
        security.boughtQuantity += quantity;
        security.boughtAmount += amount;
      }
    } else if (type === "sell") {
      summary.sold += amount;
      if (security) {
        security.soldQuantity += quantity;
        security.soldAmount += amount;
      }
    } else if (type === "fee") {
      summary.fees -= signedAmount;
      if (security) security.fees -= signedAmount;
    } else if (type === "tax") summary.taxes -= signedAmount;
    else if (type === "dividend") {
      summary.dividends += signedAmount;
      if (security) security.dividends += signedAmount;
    } else if (type === "interest") summary.interest += signedAmount;
    else if (type === "deposit") summary.deposits += signedAmount;
    else summary.withdrawals -= signedAmount;
  }

  summary.ignored = [...ignored].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  summary.netInvested = summary.bought - summary.sold;
  summary.netDeposits = summary.deposits - summary.withdrawals;
  summary.securities = [...bySecurity.values()]
    .map((security) => {
      const averageBuyPrice = security.boughtQuantity > 0 ? security.boughtAmount / security.boughtQuantity : null;
      const realised = averageBuyPrice !== null && security.soldQuantity > 0 ? security.soldAmount - security.soldQuantity * averageBuyPrice : null;
      return { ...security, averageBuyPrice, realised };
    })
    .filter((security) => security.boughtAmount + security.soldAmount + security.fees + security.dividends > 0)
    .sort((a, b) => b.boughtAmount + b.soldAmount - (a.boughtAmount + a.soldAmount));
  return summary;
}

export type SecurityFilter = "all" | "sold" | "gain" | "loss" | "dividends";

export const SECURITY_FILTERS: { value: SecurityFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "sold", label: "Sold" },
  { value: "gain", label: "Realised gain" },
  { value: "loss", label: "Realised loss" },
  { value: "dividends", label: "Paid dividends" },
];

export function matchesSecurityFilter(security: Pick<SecurityActivity, "soldQuantity" | "realised" | "dividends">, filter: SecurityFilter): boolean {
  switch (filter) {
    case "sold":
      return security.soldQuantity > 0;
    case "gain":
      return security.realised !== null && security.realised > 0;
    case "loss":
      return security.realised !== null && security.realised < 0;
    case "dividends":
      return security.dividends > 0;
    default:
      return true;
  }
}
