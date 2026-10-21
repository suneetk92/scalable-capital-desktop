import { parseDecimal } from "./format";

/**
 * Reading what Scalable's tools answer. The app keeps no copy of the output schemas, so everything here is
 * defensive: a value that is missing or of another type gives `undefined`, `null` or an empty list, never a throw.
 * The Rust side has already taken the payload out of the MCP envelope; some payloads still arrive as JSON text.
 */

export type Rec = Record<string, unknown>;

export function isRec(value: unknown): value is Rec {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The value of a tool answer: JSON text is parsed, anything else (also text that is not an object or list) is returned as it is. */
export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" ? parsed : value;
  } catch {
    return value;
  }
}

/** A finite number from a number or a numeric string as APIs send them ("12.5"); anything else is null. */
export function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Like `finiteNumber`, but a string may be typed or formatted text, where a comma can be the decimal point. */
export function decimalNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return typeof value === "string" ? parseDecimal(value) : null;
}

/** The first of `names` that the record has with a value, matched without regard to case and punctuation. */
export function pick(record: unknown, names: string[]): unknown {
  if (!isRec(record)) return undefined;
  const entries = Object.entries(record);
  for (const name of names) {
    const hit = entries.find(([key]) => normalizeKey(key) === normalizeKey(name));
    if (hit && hit[1] !== null && hit[1] !== undefined && hit[1] !== "") return hit[1];
  }
  return undefined;
}

export function pickString(record: unknown, names: string[]): string | undefined {
  const value = pick(record, names);
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

export function pickNumber(record: unknown, names: string[]): number | null {
  return finiteNumber(pick(record, names));
}

/** The records of a list; entries that are not records are dropped, and anything that is not a list gives an empty one. */
export function recordsOf(value: unknown): Rec[] {
  return Array.isArray(value) ? value.filter(isRec) : [];
}

/** The strings of a list, others dropped. */
export function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Finds the main list of records in a tool result, wherever it is wrapped. */
export function findRecords(value: unknown, depth = 0): Rec[] {
  const parsed = parseMaybeJson(value);
  if (depth > 5 || parsed === null || parsed === undefined) return [];
  if (Array.isArray(parsed)) {
    const records = parsed.filter(isRec);
    if (records.length > 0) return records;
    return parsed.flatMap((item) => findRecords(item, depth + 1));
  }
  if (!isRec(parsed)) return [];
  for (const [, child] of Object.entries(parsed)) {
    if (Array.isArray(child) && child.some(isRec)) return child.filter(isRec);
  }
  for (const child of Object.values(parsed)) {
    if (isRec(child)) {
      const nested = findRecords(child, depth + 1);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

/**
 * One alias table per concept: the names the different tools use for the same figure. The parsers read them
 * and hand the app one name (`quantity`, `lastPrice`, `avgPrice`), so no other code has to know the aliases.
 */
export const ALIASES = {
  quantity: ["quantity", "shares", "units", "numberOfShares", "positionSize", "qty", "pieces", "filledQuantity", "totalQuantity", "holdingQuantity", "filled", "position.filled", "amountOfShares"],
  lastPrice: [
    "lastPrice",
    "currentPrice",
    "price",
    "marketPrice",
    "latestPrice",
    "quote",
    "last",
    "lastTradedPrice",
    "closePrice",
    "close",
    "pricePerShare",
    "sharePrice",
    "unitPrice",
    "valuationPrice",
    "quoteMidPrice",
    "midPrice",
    "mid",
  ],
  lastPriceFallback: ["bid", "ask", "bidPrice", "askPrice", "quoteBidPrice", "quoteAskPrice"],
  avgPrice: ["averagePrice", "avgPrice", "averageBuyPrice", "avgBuyPrice", "averageCost", "averageEntryPrice", "buyInPrice", "averagePurchasePrice"],
  targetPrice: ["price", "targetPrice"],
};
