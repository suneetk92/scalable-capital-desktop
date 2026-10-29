import type { SecurityGroup } from "./groups";
import type { SecurityHit } from "./OrderDialog";
import { parseDecimal } from "./format";
import { findSinceBuy } from "./tools";
import { ALIASES, normalizeKey, parseMaybeJson, pick } from "./response";
import type { Dashboard, PortfolioSnapshot } from "./types";

export { formatMoney, formatNumber, formatPercent as formatChange } from "./format";

/** `symbol`, or the id of a table column (see `marketColumns.ts`). */
export type SortKey = string;
export type ChangeFilter = "all" | "gainers" | "losers";
export type ScreenerRow = {
  rowId: string;
  symbol: string;
  isin: string;
  portfolioId: string;
  name: string;
  exchange: string;
  lastPrice: number | null;
  change: number | null;
  quantity: number | null;
  value: number | null;
  /** Gain or loss since buying, in money: reported by Scalable, or the value minus the cost. */
  sinceBuy?: number | null;
  /** Average buy price per share: reported by Scalable, or the cost divided by the quantity. */
  avgPrice?: number | null;
  /** Total cost of the position: reported by Scalable, or the value minus the gain since buy. */
  cost?: number | null;
  /** The gain or loss since buy as a percent of the cost. */
  sinceBuyPct?: number | null;
  /** Share of the total market value of the portfolio holdings, 0 to 1. */
  weight?: number | null;
  /** Best bid and ask of the fresh quote, and the spread between them as a percent of the mid price. */
  bid?: number | null;
  ask?: number | null;
  spreadPct?: number | null;
  /** The move today in money, from the change %. */
  today?: number | null;
  currency: string;
  keys: string[];
};

export type OverviewData = {
  performance: Map<string, number>;
  balance: number | null;
  power: number | null;
  credit: number | null;
  securities: number | null;
  gainers: ScreenerRow[];
  losers: ScreenerRow[];
};

const ARRAY_KEYS = ["holdings", "positions", "securities", "items", "watchlist", "entries", "results", "data", "content"];

export function recordsFrom(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6 || value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => recordsFrom(item, depth + 1));
  }
  if (typeof value === "string") {
    const parsed = parseMaybeJson(value);
    return typeof parsed === "string" ? [] : recordsFrom(parsed, depth + 1);
  }
  if (typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  for (const key of ARRAY_KEYS) {
    const nested = pick(record, [key]);
    if (nested !== undefined) {
      const rows = recordsFrom(nested, depth + 1);
      if (rows.length > 0) return rows;
    }
  }
  const hasInstrumentField = ["symbol", "ticker", "isin", "name", "securityName", "instrumentName"].some((key) => pick(record, [key]) !== undefined);
  if (hasInstrumentField) return [record];
  const hasNestedInstrument = Object.values(record).some(
    (child) =>
      child !== null && typeof child === "object" && !Array.isArray(child) && ["symbol", "ticker", "isin", "name", "securityName", "instrumentName"].some((key) => pick(child, [key]) !== undefined),
  );
  if (hasNestedInstrument) return [record];

  for (const child of Object.values(record)) {
    const rows = recordsFrom(child, depth + 1);
    if (rows.length > 0) return rows;
  }
  return [];
}

export function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && value !== null) {
    const nested = pick(value, ["amount", "value", "total", "valuation", "price", "last", "number"]);
    if (nested !== undefined && nested !== value) return numericValue(nested);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s/g, "");
  if (!trimmed || !/\d/.test(trimmed)) return null;
  return parseDecimal(trimmed.replace(/[^\d,.-]/g, ""));
}

function flatten(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const queue: { value: Record<string, unknown>; path: string; depth: number }[] = [{ value: record, path: "", depth: 0 }];
  while (queue.length > 0) {
    const { value, path, depth } = queue.shift()!;
    for (const [key, child] of Object.entries(value)) {
      if (child === null || child === undefined || child === "") continue;
      if (!(key in out)) out[key] = child;
      if (path) out[`${path}.${key}`] = child;
      if (typeof child === "object" && !Array.isArray(child) && depth < 3) {
        queue.push({ value: child as Record<string, unknown>, path: path ? `${path}.${key}` : key, depth: depth + 1 });
      }
    }
  }
  return out;
}

function looksNumeric(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "object" && value !== null) return !Array.isArray(value);
  return typeof value === "string" && /^[+-]?\s*[\d.,\s']+\s*(%|[A-Za-z]{3}|[€$£])?$/.test(value.trim());
}

const ONE_DAY = /^(oneday|1d|d1|day|daily|today|intraday|lastday)$/;

function performanceChange(source: unknown, depth = 0): number | null {
  if (depth > 5 || source === null || typeof source !== "object") return null;
  if (Array.isArray(source)) {
    const entries = source.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item));
    const today = entries.find((entry) => {
      const frame = pick(entry, ["timeframe", "timeFrame", "period", "range"]);
      return typeof frame === "string" && ONE_DAY.test(normalizeKey(frame)) && pick(entry, ["performance", "performancePercent"]) !== undefined;
    });
    if (today) {
      const fraction = numericValue(pick(today, ["performance", "performancePercent"]));
      if (fraction !== null) return fraction * 100;
    }
    for (const item of source) {
      const nested = performanceChange(item, depth + 1);
      if (nested !== null) return nested;
    }
    return null;
  }
  for (const child of Object.values(source as Record<string, unknown>)) {
    const nested = performanceChange(child, depth + 1);
    if (nested !== null) return nested;
  }
  return null;
}

type Pattern = [RegExp, RegExp?];

function pickNumber(flat: Record<string, unknown>, exact: string[], patterns: Pattern[] = [], fallback: string[] = []): number | null {
  for (const name of exact) {
    const direct = numericValue(pick(flat, [name]));
    if (direct !== null) return direct;
  }
  for (const [include, exclude] of patterns) {
    for (const [key, value] of Object.entries(flat)) {
      const normalized = normalizeKey(key);
      if (!include.test(normalized) || exclude?.test(normalized) || !looksNumeric(value)) continue;
      const parsed = numericValue(value);
      if (parsed !== null) return parsed;
    }
  }
  return numericValue(pick(flat, fallback));
}

function pickText(flat: Record<string, unknown>, names: string[], pattern?: RegExp): string | undefined {
  const direct = pick(flat, names);
  if (typeof direct === "string" || typeof direct === "number") return String(direct);
  if (!pattern) return undefined;
  for (const [key, value] of Object.entries(flat)) {
    if (pattern.test(normalizeKey(key)) && typeof value === "string" && value) return value;
  }
  return undefined;
}

const NOT_PRICE = /buy|avg|average|purchase|cost|entry|change|perf|percent|pct|currency|time|date|volume|size|quantity|target|alert|stop|limit|isin/;
const NOT_PERCENT = /abs|amount|value|currency|time|date|alloc|weight|share|ytd|since|total|dividend|yield|cost|buy/;
const NOT_VALUE = /change|perf|buy|cost|purchase|avg|average|percent|pct|currency|time|date|price|profit|loss|pnl|gain|return|alloc|weight|fee|tax/;

/** Splits a holdings response into securities and crypto holdings (`cryptoHoldings`), which come in a separate list. */
export function splitHoldings(value: unknown): { securities: unknown; crypto: Record<string, unknown>[] } {
  const parsed = parseMaybeJson(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { securities: parsed, crypto: [] };
  const { cryptoHoldings, ...securities } = parsed as Record<string, unknown>;
  const crypto = Array.isArray(cryptoHoldings) ? cryptoHoldings.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item)) : [];
  return { securities, crypto };
}

/** Scalable lists every supported coin, also at 0; only coins with a positive amount or value are real holdings. */
function hasCryptoPosition(record: Record<string, unknown>) {
  const flat = flatten(record);
  return Object.entries(flat).some(([key, raw]) => {
    if (!/quantit|amount|balanc|filled|size|valu|units|holding|position/i.test(key)) return false;
    if (/price|pending|blocked|time|date|currency|perform|return/i.test(key)) return false;
    const number = numericValue(raw);
    return number !== null && number > 0;
  });
}

const COST_NAMES = ["costBasis", "totalCost", "invested", "investedAmount", "buyInValue", "purchaseValue", "costValue", "totalInvested"];

/** The gain or loss since buy in money: the figure Scalable reports, else the value minus the cost (or the average price times the quantity). */
function sinceBuyOf(flat: Record<string, unknown>, value: number | null, quantity: number | null): number | null {
  const reported = findSinceBuy(flat);
  if (reported?.absolute != null) return reported.absolute;
  if (value === null) return null;
  const performance = reported?.fraction ?? null;
  if (performance !== null && performance > -1) return value - value / (1 + performance);
  const cost = numericValue(pick(flat, COST_NAMES));
  if (cost !== null) return value - cost;
  const average = numericValue(pick(flat, ALIASES.avgPrice));
  if (average !== null && quantity !== null) return value - average * quantity;
  return scanSinceBuy(flat, value, quantity);
}

/** The cost of a position and its average buy price: the figures Scalable reports, else worked out from each other, the value and the gain. */
function costOf(flat: Record<string, unknown>, value: number | null, quantity: number | null, sinceBuy: number | null): { avgPrice: number | null; cost: number | null } {
  const reportedAverage = numericValue(pick(flat, ALIASES.avgPrice));
  const cost =
    numericValue(pick(flat, COST_NAMES)) ?? (reportedAverage !== null && quantity !== null ? reportedAverage * quantity : null) ?? (value !== null && sinceBuy !== null ? value - sinceBuy : null);
  return { avgPrice: reportedAverage ?? (cost !== null && quantity ? cost / quantity : null), cost };
}

const GAIN_KEY = /(absolute|simple|total|unrealized|unrealised)?(return|profit|pnl|gain|result)(loss)?$/;
const GAIN_NOT = /percent|pct|rate|today|day|week|month|year|ytd|daily|perform|dividend|fee|tax|realized(?!.*un)/;
const COST_KEY = /(buyin|cost|invest|purchase|acquisition|entry)(value|amount|total|basis|sum)*$/;
const AVERAGE_KEY = /(avg|average).*(price|buy|cost|entry|purchase)|(buyin|entry|purchase|acquisition)price/;

/** Last resort for field names not listed above: matches the key names by pattern. */
function scanSinceBuy(flat: Record<string, unknown>, value: number, quantity: number | null): number | null {
  const find = (include: RegExp, exclude?: RegExp) => {
    for (const [key, raw] of Object.entries(flat)) {
      const normalized = normalizeKey(key.split(".").pop() ?? key);
      if (!include.test(normalized) || exclude?.test(normalized) || !looksNumeric(raw)) continue;
      const parsed = numericValue(raw);
      if (parsed !== null) return parsed;
    }
    return null;
  };
  const gain = find(GAIN_KEY, GAIN_NOT);
  if (gain !== null) return gain;
  const cost = find(COST_KEY, /price|per|share|unit/);
  if (cost !== null && cost > 0) return value - cost;
  const average = find(AVERAGE_KEY);
  return average !== null && quantity !== null ? value - average * quantity : null;
}

export function holdingRows(portfolioId: string, holdings: unknown, quotes?: Record<string, unknown>): ScreenerRow[] {
  const { securities, crypto } = splitHoldings(holdings);
  const securityRows = recordsFrom(securities).map((record, index) => rowFromRecord(record, index, portfolioId, quotes));
  const cryptoRows = crypto.filter(hasCryptoPosition).map((record, index) => {
    const row = rowFromRecord(record, index, portfolioId, quotes);
    return { ...row, rowId: `${portfolioId}-crypto-${row.symbol}-${index}`, exchange: row.exchange === "—" ? "CRYPTO" : row.exchange };
  });
  return [...securityRows, ...cryptoRows];
}

export function rowFromRecord(record: Record<string, unknown>, index: number, context: string, quotes?: Record<string, unknown>): ScreenerRow {
  let flat = flatten(record);
  const isinValue = pickText(flat, ["isin"]);
  const quote = isinValue && quotes ? quotes[isinValue] : undefined;
  let quoteFlat: Record<string, unknown> | null = null;
  if (quote && typeof quote === "object") {
    quoteFlat = flatten(Array.isArray(quote) && typeof quote[0] === "object" && quote[0] !== null ? (quote[0] as Record<string, unknown>) : (quote as Record<string, unknown>));
    flat = { ...quoteFlat, ...flat };
  }

  const quoteSource = Array.isArray(quote) ? quote[0] : quote;
  const symbol = pickText(flat, ["symbol", "ticker", "tradingSymbol", "instrumentSymbol", "isin", "wkn"]) ?? "";
  const name = pickText(flat, ["name", "securityName", "instrumentName", "displayName", "companyName", "productName", "title"], /name|title/) ?? (symbol || "Security");
  const currency = pickText(flat, ["currency", "quoteCurrency", "tradingCurrency"], /currency/) ?? "EUR";

  // The freshly fetched quote wins over the price embedded in the holdings/watchlist record,
  // which can be minutes old.
  let price =
    (quoteFlat ? pickNumber(quoteFlat, ALIASES.lastPrice, [[/price|quote|last/, NOT_PRICE]], ALIASES.lastPriceFallback) : null) ??
    pickNumber(flat, ALIASES.lastPrice, [[/price|quote|last/, NOT_PRICE]], ALIASES.lastPriceFallback);
  const changeNames = [
    "changePercent",
    "dailyChangePercent",
    "priceChangePercent",
    "performancePercent",
    "changePercentage",
    "changePct",
    "percentChange",
    "dayChangePercent",
    "todayChangePercent",
    "dailyChangePct",
    "relativeChange",
    "pctChange",
  ];
  const change =
    pickNumber(flat, changeNames) ??
    performanceChange(record) ??
    performanceChange(quoteSource) ??
    pickNumber(
      flat,
      [],
      [
        [/(day|daily|today|1d)/, /abs|amount|value|currency|time|date|ytd|since|total/],
        [/(pct|percent|relative)/, NOT_PERCENT],
        [/(change|perf)/, NOT_PERCENT],
      ],
    );
  const quantity = pickNumber(flat, ALIASES.quantity, [
    [/quantity|shares|units|qty|pieces|filled|holding|position/, /price|value|cost|buy|avg|average|alloc|weight|pending|blocked|valuation|fifo|currency|time|date/],
  ]);
  let value = pickNumber(
    flat,
    [
      "marketValue",
      "positionValue",
      "currentValue",
      "totalValue",
      "value",
      "valuation",
      "marketValuation",
      "totalMarketValue",
      "positionMarketValue",
      "worth",
      "notional",
      "balance",
      "valuationAmount",
      "currentAmount",
    ],
    [[/valu|worth|notional|balance/, NOT_VALUE]],
    ["amount", "totalAmount", "positionAmount", "total"],
  );
  if (value === null && price !== null && quantity !== null) value = price * quantity;
  if (price === null && value !== null && quantity) price = value / quantity;
  const bid = quoteFlat ? pickNumber(quoteFlat, ["bidPrice", "bid", "quoteBidPrice"]) : null;
  const ask = quoteFlat ? pickNumber(quoteFlat, ["askPrice", "ask", "quoteAskPrice"]) : null;
  const sinceBuy = sinceBuyOf(flat, value, quantity);
  const { avgPrice, cost } = costOf(flat, value, quantity, sinceBuy);

  return {
    rowId: `${context}-${symbol || name}-${index}`,
    symbol: symbol || name,
    isin: isinValue ?? "",
    portfolioId: context === "watch" ? "" : context,
    name,
    exchange:
      pickText(flat, ["exchange", "venue", "market", "tradingVenue", "exchangeName", "mic"], /exchange|venue/) ??
      pickText(flat, ["securityType", "type", "instrumentType", "assetClass"])?.replace(/_/g, " ") ??
      "—",
    lastPrice: price,
    change,
    quantity,
    value,
    sinceBuy,
    bid,
    ask,
    spreadPct: bid !== null && ask !== null && bid > 0 && ask >= bid ? ((ask - bid) / ((ask + bid) / 2)) * 100 : null,
    avgPrice,
    cost,
    sinceBuyPct: sinceBuy !== null && cost !== null && cost > 0 ? (sinceBuy / cost) * 100 : null,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "EUR",
    keys: Object.keys(flat).filter((key) => !key.includes(".")),
  };
}

export function parseSearch(payload: unknown): SecurityHit[] {
  const seen = new Set<string>();
  return recordsFrom(payload)
    .map((record, index) => rowFromRecord(record, index, "search"))
    .filter((row) => row.isin && !seen.has(row.isin) && seen.add(row.isin))
    .map((row) => ({ isin: row.isin, name: row.name, symbol: row.symbol, currency: row.currency }));
}

export function buyingPower(cash: unknown): number | null {
  if (!cash || typeof cash !== "object") return null;
  return pickNumber(flatten(cash as Record<string, unknown>), ["buyingPower", "availableBuyingPower", "availableCash", "cash"], [[/buyingpower|availablecash/, /credit|deriv/]]);
}

function currencyOf(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const currency = pick(flatten(value as Record<string, unknown>), ["currency", "currencyCode", "cashCurrency", "portfolioCurrency"]);
  return typeof currency === "string" && /^[A-Z]{3}$/.test(currency) ? currency : null;
}

export function portfolioCurrency(portfolio: unknown, cash: unknown): string | null {
  return currencyOf(portfolio) ?? currencyOf(cash);
}

export function overviewTotal(overview: unknown): number | null {
  if (!overview || typeof overview !== "object") return null;
  const flat = flatten(recordsFromOverview(overview));
  return pickNumber(
    flat,
    ["valuation.total", "totalValue", "portfolioValue", "totalValuation", "totalMarketValue", "netAssetValue", "total", "valuation", "marketValue"],
    [[/(total|portfolio|net).*valu|valu.*total/, /crypto|securit|change|perf|return|currency|time|date|cash/]],
    ["securitiesValuation", "securities"],
  );
}

const OVERVIEW_TIMEFRAMES: [string, string][] = [
  ["INTRADAY", "Today"],
  ["TWO_DAYS", "2 days"],
  ["ONE_WEEK", "1 week"],
  ["ONE_MONTH", "1 month"],
  ["THREE_MONTHS", "3 months"],
  ["SIX_MONTHS", "6 months"],
  ["YEAR_TO_DATE", "Year to date"],
  ["ONE_YEAR", "1 year"],
  ["MAX", "Max"],
];

export function overviewPerformance(overview: unknown): Map<string, number> {
  const result = new Map<string, number>();
  const performance = pick(recordsFromOverview(overview), ["performance", "performances"]);
  if (!Array.isArray(performance)) return result;
  for (const [timeframe, label] of OVERVIEW_TIMEFRAMES) {
    const entry = performance.find((item) => String(pick(item, ["timeframe"]) ?? "").toUpperCase() === timeframe);
    const value = entry ? numericValue(pick(entry, ["simpleAbsoluteReturn", "absoluteReturn", "return"])) : null;
    if (value !== null) result.set(label, value);
  }
  return result;
}

export function cashFigures(cash: unknown): { balance: number | null; buyingPower: number | null; credit: number | null } {
  const flat = flatten(recordsFromOverview(cash));
  return {
    balance: pickNumber(flat, ["cashBalance", "balance"]),
    buyingPower: pickNumber(flat, ["buyingPower", "availableBuyingPower"]),
    credit: pickNumber(flat, ["availableCreditLine"]),
  };
}

function overviewSecurities(overview: unknown): number | null {
  return pickNumber(flatten(recordsFromOverview(overview)), ["valuation.securities", "securitiesValuation", "securities"]);
}

/** Whether a row belongs to a group. A group lives in one portfolio, so the same ISIN held in another portfolio is not in it. */
export function groupHas(group: SecurityGroup, row: ScreenerRow) {
  const samePortfolio = !group.portfolioId || !row.portfolioId || group.portfolioId === row.portfolioId;
  return (row.isin !== "" && samePortfolio && group.isins.includes(row.isin)) || (row.portfolioId !== "" && group.portfolioIds.includes(row.portfolioId));
}

function recordsFromOverview(overview: unknown): Record<string, unknown> {
  const parsed = parseMaybeJson(overview);
  if (Array.isArray(parsed)) return parsed.length > 0 ? recordsFromOverview(parsed[0]) : {};
  return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

export function csvCell(value: string | number | null) {
  if (value === null) return "";
  const text = String(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function summarizeOverview(portfolios: PortfolioSnapshot[], portfolioRows: ScreenerRow[]): OverviewData {
  const performance = new Map<string, number>();
  let balance: number | null = null;
  let power: number | null = null;
  let credit: number | null = null;
  let securities: number | null = null;
  for (const portfolio of portfolios) {
    for (const [label, value] of overviewPerformance(portfolio.overview)) performance.set(label, (performance.get(label) ?? 0) + value);
    const figures = cashFigures(portfolio.cash);
    if (figures.balance !== null) balance = (balance ?? 0) + figures.balance;
    if (figures.buyingPower !== null) power = (power ?? 0) + figures.buyingPower;
    if (figures.credit !== null) credit = (credit ?? 0) + figures.credit;
    const held = overviewSecurities(portfolio.overview);
    if (held !== null) securities = (securities ?? 0) + held;
  }
  const moving = portfolioRows.filter((row) => row.change !== null);
  const byChange = [...moving].sort((left, right) => (right.change ?? 0) - (left.change ?? 0));
  return {
    performance,
    balance,
    power,
    credit,
    securities,
    gainers: byChange.filter((row) => (row.change ?? 0) > 0).slice(0, 5),
    losers: byChange
      .filter((row) => (row.change ?? 0) < 0)
      .reverse()
      .slice(0, 5),
  };
}

export function dataIssueMessages(dashboard: Dashboard | null): string[] {
  const short = (message: string) => (message.length > 180 ? `${message.slice(0, 180)}…` : message);
  const issues: string[] = [];
  for (const portfolio of dashboard?.portfolios ?? []) {
    if (portfolio.overviewError) issues.push(`Performance and portfolio value for ${portfolio.name}: ${short(portfolio.overviewError)}`);
    if (portfolio.cashError) issues.push(`Cash and buying power for ${portfolio.name}: ${short(portfolio.cashError)}`);
  }
  if (dashboard?.watchlistError) issues.push(`Watchlist: ${short(dashboard.watchlistError)}`);
  return issues;
}
