import { formatDate, formatMoney, formatNumber } from "./format";
import { decimalNumber as parseNumber, findRecords, isRec, parseMaybeJson, pick, type Rec } from "./response";

export type FoundSecurity = {
  isin: string;
  name: string;
  symbol?: string;
  type: string;
  currency?: string;
  lastPrice?: number | null;
  quoteAt?: string | null;
  isOutdated?: boolean;
  record: Rec;
};

export type FoundDerivative = {
  isin: string | null;
  name: string;
  issuer: string;
  strategy: string | null;
  leverage: string | null;
  strike: string | null;
  knockoutBarrier: string | null;
  expiry: string | null;
  premium: string | null;
  currency: string;
  record: Rec;
};

function deepValue(value: unknown, names: string[], depth = 0): unknown {
  const parsed = parseMaybeJson(value);
  if (depth > 5 || parsed === null || parsed === undefined) return undefined;
  if (Array.isArray(parsed)) {
    for (const child of parsed) {
      const nested = deepValue(child, names, depth + 1);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }
  if (!isRec(parsed)) return undefined;
  const direct = pick(parsed, names);
  if (direct !== undefined) return direct;
  for (const child of Object.values(parsed)) {
    const nested = deepValue(child, names, depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const result = String(value).trim();
  return result || undefined;
}

function fieldText(record: unknown, names: string[]): string | undefined {
  return text(deepValue(record, names));
}

function numberValue(value: unknown): number | null {
  if (isRec(value)) return numberValue(pick(value, ["amount", "value", "price", "number"]));
  return parseNumber(value);
}

function fieldNumber(record: unknown, names: string[]): number | null {
  return numberValue(deepValue(record, names));
}

function resultRecords(value: unknown, depth = 0): Rec[] {
  if (depth > 5) return [];
  const parsed = parseMaybeJson(value);
  const records = findRecords(parsed);
  if (records.length > 0) return records;
  if (Array.isArray(parsed)) return parsed.flatMap((item) => resultRecords(item, depth + 1));
  if (isRec(parsed)) return Object.values(parsed).flatMap((child) => resultRecords(child, depth + 1));
  return [];
}

function currencyOf(record: unknown): string {
  const currency = fieldText(record, ["currency", "currencyCode", "quoteCurrency"]);
  return currency && /^[A-Z]{3}$/i.test(currency) ? currency.toUpperCase() : "EUR";
}

function outdated(value: unknown): boolean {
  if (value === true) return true;
  return typeof value === "string" && /^(true|yes|1)$/i.test(value.trim());
}

/** Reads securities from Scalable's search response without assuming a fixed wrapper or output schema. */
export function parseFoundSecurities(result: unknown): FoundSecurity[] {
  const seen = new Set<string>();
  return resultRecords(result).flatMap((record) => {
    const isin = fieldText(record, ["isin", "securityId"]);
    const key = isin?.toUpperCase();
    if (!isin || !key || seen.has(key)) return [];
    seen.add(key);
    const security = deepValue(record, ["security", "instrument"]);
    const quote = deepValue(record, ["currentQuote", "quote"]);
    const name = fieldText(record, ["name", "securityName"]) ?? fieldText(security, ["name", "securityName"]) ?? isin;
    const symbol = fieldText(record, ["symbol", "ticker"]) ?? fieldText(security, ["symbol", "ticker"]) ?? name;
    const currency = currencyOf(quote ?? record);
    return [
      {
        isin,
        name,
        symbol,
        type: fieldText(record, ["securityType", "type"]) ?? fieldText(security, ["securityType", "type"]) ?? "",
        currency,
        lastPrice: fieldNumber(quote ?? record, ["midPrice", "price", "lastPrice"]),
        quoteAt: fieldText(quote ?? record, ["timestampUtc", "timestamp", "quotedAt"]) ?? null,
        isOutdated: outdated(deepValue(quote ?? record, ["isOutdated", "isDelayed"])),
        record,
      },
    ];
  });
}

function formattedPrice(record: unknown, names: string[], currency: string): string | null {
  const value = deepValue(record, names);
  if (value === undefined) return null;
  const number = numberValue(value);
  return number === null ? (text(value) ?? null) : formatMoney(number, currency);
}

function formattedLeverage(value: string | undefined): string | null {
  if (!value) return null;
  const number = parseNumber(value.replace(/[×x]$/i, ""));
  return number === null ? value : `${formatNumber(number)}×`;
}

function expiryLabel(value: string | undefined): string | null {
  if (!value) return null;
  if (/^(open[ _-]?end(ed)?|perpetual|unlimited|no[ _-]?expiry)$/i.test(value)) return "Open end";
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? formatDate(value) : value;
}

/** Parses the product fields used by Discover's derivatives table, including open-ended expiries. */
export function parseFoundDerivatives(result: unknown): FoundDerivative[] {
  const seen = new Set<string>();
  return resultRecords(result).flatMap((record) => {
    const isin = fieldText(record, ["isin", "securityId"]);
    const key = isin?.toUpperCase();
    if (key && seen.has(key)) return [];
    const issuer = fieldText(record, ["issuer", "issuerName", "provider"]) ?? "";
    const subcategory = fieldText(record, ["productSubcategory", "subcategory", "productType"]) ?? "";
    if (!isin && !issuer && !subcategory) return [];
    if (key) seen.add(key);
    const currency = currencyOf(record);
    const strategy = fieldText(record, ["strategy", "strategyName"]);
    const name = [issuer, subcategory].filter(Boolean).join(" · ") || isin || "Derivative";
    return [
      {
        isin: isin ?? null,
        name,
        issuer,
        strategy: strategy ?? null,
        leverage: formattedLeverage(fieldText(record, ["leverage", "leverageFactor"])),
        strike: formattedPrice(record, ["strike", "strikePrice"], currency),
        knockoutBarrier: formattedPrice(record, ["knockoutBarrier", "knockOutBarrier", "barrier"], currency),
        expiry: expiryLabel(fieldText(record, ["expiry", "expiryDate", "expirationDate", "maturityDate"])),
        premium: formattedPrice(record, ["premium", "currentPremium"], currency),
        currency,
        record,
      },
    ];
  });
}