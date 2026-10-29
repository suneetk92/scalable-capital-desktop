import type { View } from "./nav";
import { formatDate, formatDateTime, formatNumber, parseDecimal } from "./format";
import { invokeCommand } from "./commands";
import { finiteNumber, isRec, normalizeKey as norm, parseMaybeJson, pick, type Rec } from "./response";

export type SchemaProp = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  items?: SchemaProp;
  properties?: Record<string, SchemaProp>;
  oneOf?: SchemaProp[];
  default?: unknown;
};

export type ToolDef = {
  name: string;
  description?: string | null;
  inputSchema?: { properties?: Record<string, SchemaProp>; required?: string[] } | null;
};

export type ToolOutcome = { name: string; ok: boolean; result?: unknown; error?: string };
export type Invoke = <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
type ToolCall = { name: string; arguments: Record<string, unknown> };

type ToolStat = { calls: number; failures: number; last: number };
const stats = new Map<string, ToolStat>();
const statListeners = new Set<() => void>();

export function toolStats() {
  return stats;
}

export function subscribeToolStats(listener: () => void) {
  statListeners.add(listener);
  return () => {
    statListeners.delete(listener);
  };
}

export async function callTools(invoke: Invoke, calls: ToolCall[]): Promise<ToolOutcome[]> {
  if (calls.length === 0) return [];
  const outcomes = await invokeCommand(invoke, "call_tools", { calls });
  for (const outcome of outcomes) {
    const stat = stats.get(outcome.name) ?? { calls: 0, failures: 0, last: 0 };
    stat.calls += 1;
    if (!outcome.ok) stat.failures += 1;
    stat.last = Date.now();
    stats.set(outcome.name, stat);
  }
  statListeners.forEach((listener) => listener());
  return outcomes;
}

function propType(prop: SchemaProp | undefined): string {
  const type = prop?.type;
  return Array.isArray(type) ? (type.find((item) => item !== "null") ?? "") : (type ?? "");
}

export function coerce(prop: SchemaProp | undefined, value: unknown): unknown | undefined {
  const type = propType(prop);
  let next = value;
  if (prop?.enum && prop.enum.length > 0 && typeof next === "string") {
    const wanted = norm(next);
    const match = prop.enum.find((item) => typeof item === "string" && (norm(item) === wanted || norm(item).includes(wanted) || wanted.includes(norm(item))));
    if (match === undefined) return undefined;
    next = match;
  }
  if (type === "string" && (typeof next === "number" || typeof next === "boolean")) return String(next);
  if (type === "number" || type === "integer") {
    const parsed = typeof next === "number" ? next : parseDecimal(String(next));
    return parsed !== null && Number.isFinite(parsed) ? (type === "integer" ? Math.round(parsed) : parsed) : undefined;
  }
  if (type === "array") {
    const list = Array.isArray(next) ? next : [next];
    if (propType(prop?.items) === "object") {
      const itemProps = Object.keys(prop?.items?.properties ?? {});
      const key = itemProps.find((item) => norm(item).includes("isin")) ?? itemProps[0] ?? "isin";
      return list.map((item) => (item !== null && typeof item === "object" ? item : { [key]: item }));
    }
    return list;
  }
  if (type === "boolean") return typeof next === "boolean" ? next : String(next) === "true";
  return next;
}

type BuiltArgs = { args: Record<string, unknown>; missing: string[] };

/**
 * Builds a tool's arguments from values named like the schema properties Scalable publishes (isin,
 * portfolioId, groupId, ...). Values the tool's schema has no property for are left out, and each value
 * is coerced to the property's type. With `fillDefaults`, required properties that are still empty get the
 * schema default or the first enum value; use that for read-only tools only.
 */
export function buildArgs(tool: ToolDef | undefined, semantic: Record<string, unknown>, fillDefaults = false): BuiltArgs {
  const properties = tool?.inputSchema?.properties ?? {};
  const keys = Object.keys(properties);
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(semantic)) {
    if (value === undefined || value === null || value === "") continue;
    if (keys.length === 0) {
      args[key] = value;
      continue;
    }
    if (!keys.includes(key)) continue;
    const coerced = coerce(properties[key], value);
    if (coerced !== undefined) args[key] = coerced;
  }
  // create_price_alert takes `instrument: { kind: "security", isin } | { kind: "crypto", ticker }`.
  if ("instrument" in properties && !("instrument" in args)) {
    const isin = semantic.isin;
    if (typeof isin === "string" && isin !== "") args.instrument = { kind: "security", isin };
  }
  const required = tool?.inputSchema?.required ?? [];
  if (fillDefaults) {
    for (const key of required) {
      if (key in args) continue;
      const prop = properties[key];
      if (prop?.default !== undefined) args[key] = prop.default;
      else if (prop?.enum && prop.enum.length > 0) args[key] = prop.enum[0];
    }
  }
  return { args, missing: required.filter((key) => !(key in args)) };
}

/** True when the tool takes a list of ISINs; false when it takes one ISIN per call. */
export function acceptsIsinList(tool: ToolDef | undefined) {
  const properties = tool?.inputSchema?.properties ?? {};
  return Object.entries(properties).some(([key, prop]) => propType(prop) === "array" && /isin|holding|securit/i.test(key));
}

export function isReadTool(name: string) {
  const lower = name.trim().toLowerCase();
  return lower === "ping" || /^(get|list|search|preview)_/.test(lower);
}

export function isWriteTool(name: string) {
  return !isReadTool(name);
}

const ACTION_VERBS: Record<string, { label: string; busy: string; destructive: boolean }> = {
  add: { label: "Add", busy: "Adding…", destructive: false },
  create: { label: "Create", busy: "Creating…", destructive: false },
  upsert: { label: "Save", busy: "Saving…", destructive: false },
  update: { label: "Save", busy: "Saving…", destructive: false },
  remove: { label: "Remove", busy: "Removing…", destructive: true },
  delete: { label: "Delete", busy: "Deleting…", destructive: true },
};

/** Button text for running a tool: "Create" for create_price_alert, "Run" for tools that only read. */
export function actionLabel(name: string) {
  const verb = name.split("_")[0];
  const known = ACTION_VERBS[verb];
  if (known) return known;
  if (verb === "submit" || verb === "cancel") return { label: humanize(name), busy: "Sending…", destructive: true };
  return { label: "Run", busy: "Running…", destructive: false };
}

function sampleValue(prop: SchemaProp | undefined, depth = 0): unknown {
  if (!prop || depth > 3) return "text";
  if (prop.enum && prop.enum.length > 0) return prop.enum[0];
  if (!prop.properties && prop.oneOf && prop.oneOf.length > 0) return sampleValue(prop.oneOf.find((option) => option.properties) ?? prop.oneOf[0], depth + 1);
  const type = propType(prop) || (prop.properties ? "object" : "");
  if (type === "object") return Object.fromEntries(Object.entries(prop.properties ?? {}).map(([key, child]) => [key, sampleValue(child, depth + 1)]));
  if (type === "array") return [sampleValue(prop.items, depth + 1)];
  if (type === "number" || type === "integer") return 1;
  if (type === "boolean") return true;
  return "text";
}

export const INSTRUMENT_EXAMPLES = ['{"kind": "security", "isin": "US0378331005"}', '{"kind": "crypto", "ticker": "BTC"}'];

/** An example value for a JSON field: the known instrument shapes, otherwise built from the tool's schema. */
export function exampleJson(key: string, prop: SchemaProp | undefined) {
  if (key === "instrument") return INSTRUMENT_EXAMPLES[0];
  return JSON.stringify(sampleValue(prop));
}

/** Scalable's "Limited access" tools: watchlists, price alerts and portfolio groups. Restricted access is enough for them; any other name needs Full access. Keep in sync with `MANAGE_TOOLS` in trading.rs. */
const MANAGE_TOOLS = new Set([
  "add_watchlist_item",
  "remove_watchlist_item",
  "create_price_alert",
  "remove_price_alert",
  "create_portfolio_group",
  "upsert_portfolio_group",
  "remove_portfolio_group",
  "add_portfolio_group_holdings",
  "remove_portfolio_group_holdings",
]);

export function isManageTool(name: string) {
  return isWriteTool(name) && MANAGE_TOOLS.has(name.trim().toLowerCase());
}

/** All other tools that change data (orders, savings plans, unknown ones) need Full access. */
export function isTradingTool(name: string) {
  return isWriteTool(name) && !isManageTool(name);
}

/**
 * Submit tools that only their own dialog may call, because that dialog previews and confirms first.
 * The backend refuses them from the generic runner too (`BLOCKED_GENERIC_TOOLS` in `src-tauri/src/mcp/trading.rs`).
 */
export const DIALOG_ONLY_TOOLS: Record<string, string> = {
  submit_buy_order: "the order dialog",
  submit_sell_order: "the order dialog",
  submit_savings_plan: "the savings plan dialog",
};

export function pretty(value: unknown) {
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function errorText(error: unknown, fallback = "Something went wrong.") {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return fallback;
}

export function humanize(key: string) {
  const words = key
    .replace(/[_.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Copy of a tool result without the records `match` accepts, wherever they sit in it. */
export function withoutRecords(value: unknown, match: (record: Rec) => boolean, depth = 0): unknown {
  const parsed = parseMaybeJson(value);
  if (depth > 5) return parsed;
  if (Array.isArray(parsed)) return parsed.filter((item) => !(isRec(item) && match(item))).map((item) => withoutRecords(item, match, depth + 1));
  if (!isRec(parsed)) return parsed;
  return Object.fromEntries(Object.entries(parsed).map(([key, child]) => [key, withoutRecords(child, match, depth + 1)]));
}

type Field = { path: string; value: string | number | boolean };

/** Scalar fields of a record, nested objects joined with dots, up to two levels. */
export function scalarFields(record: Rec, prefix = "", depth = 0, out: Field[] = []): Field[] {
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out.push({ path, value });
    else if (isRec(value) && depth < 2) scalarFields(value, path, depth + 1, out);
  }
  return out;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

export function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return formatNumber(value, 4);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    if (DATE_PATTERN.test(value)) {
      const date = new Date(value);
      // A date without a time is a calendar day: formatDate shows it in UTC when it gets the text.
      if (!Number.isNaN(date.getTime())) return value.length > 10 ? formatDateTime(date) : formatDate(value, { dateStyle: "medium" });
    }
    return value;
  }
  return JSON.stringify(value);
}

export type SeriesPoint = { label: string; value: number };

const VALUE_KEYS = ["close", "price", "midPrice", "mid", "value", "last", "closePrice", "y", "c"];
const TIME_KEYS = ["timestamp", "timestampUtc", "time", "date", "t", "x", "dateTime"];

/** A readable time for a chart point: ISO dates and epoch seconds or milliseconds are formatted, anything else is kept. */
export function formatPointTime(label: string) {
  const text = label.trim();
  if (/^\d{9,13}$/.test(text)) {
    const date = new Date(text.length <= 10 ? Number(text) * 1000 : Number(text));
    return Number.isNaN(date.getTime()) ? label : formatDateTime(date);
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? label : formatDateTime(date);
  }
  if (DATE_PATTERN.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? label : formatDate(text, { dateStyle: "medium" });
  }
  return label;
}

/** Epoch seconds for every point when all labels are dates or epoch times in strictly rising order, otherwise null (the chart then spaces the points evenly). */
export function seriesTimes(points: SeriesPoint[]): number[] | null {
  const times: number[] = [];
  for (const point of points) {
    const text = point.label.trim();
    let ms = NaN;
    if (/^\d{9,13}$/.test(text)) ms = text.length <= 10 ? Number(text) * 1000 : Number(text);
    else if (DATE_PATTERN.test(text)) ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) || /(Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}Z`);
    if (Number.isNaN(ms)) return null;
    const seconds = Math.floor(ms / 1000);
    if (times.length > 0 && seconds <= times[times.length - 1]) return null;
    times.push(seconds);
  }
  return times;
}

/** Looks for a price series inside a chart result: a list of numbers, pairs or records. */
export function extractSeries(value: unknown, depth = 0): SeriesPoint[] {
  const parsed = parseMaybeJson(value);
  if (depth > 6 || parsed === null || parsed === undefined) return [];
  if (Array.isArray(parsed)) {
    if (parsed.length >= 2 && parsed.every((item) => typeof item === "number")) return (parsed as number[]).map((v, i) => ({ label: String(i + 1), value: v }));
    if (parsed.length >= 2 && parsed.every((item) => Array.isArray(item) && item.length >= 2 && typeof item[1] === "number")) {
      return (parsed as unknown[][]).map((item) => ({ label: String(item[0]), value: item[1] as number }));
    }
    const records = parsed.filter(isRec);
    if (records.length >= 2) {
      const points: SeriesPoint[] = [];
      for (const record of records) {
        const numeric = VALUE_KEYS.map((key) => pick(record, [key])).find((item) => typeof item === "number" || (typeof item === "string" && item.trim() !== "" && Number.isFinite(Number(item))));
        if (numeric === undefined) continue;
        points.push({ label: String(pick(record, TIME_KEYS) ?? points.length + 1), value: Number(numeric) });
      }
      if (points.length >= 2) return points;
    }
    for (const item of parsed) {
      const nested = extractSeries(item, depth + 1);
      if (nested.length >= 2) return nested;
    }
    return [];
  }
  if (!isRec(parsed)) return [];
  for (const child of Object.values(parsed)) {
    const nested = extractSeries(child, depth + 1);
    if (nested.length >= 2) return nested;
  }
  return [];
}

/** Values of the `timeframe` enum of get_security_chart (verified against Scalable's tool schema). */
export const TIMEFRAMES: [string, string][] = [
  ["one_day", "1D"],
  ["seven_days", "1W"],
  ["one_month", "1M"],
  ["three_months", "3M"],
  ["six_months", "6M"],
  ["year_to_date", "YTD"],
  ["one_year", "1Y"],
  ["max", "Max"],
];

/** Shortest period first; open-ended periods (since buy, max) last. Periods not listed keep their order after these. */
const TIMEFRAME_ORDER = [
  "intraday",
  "one_day",
  "two_days",
  "three_days",
  "five_days",
  "seven_days",
  "one_week",
  "two_weeks",
  "one_month",
  "three_months",
  "six_months",
  "year_to_date",
  "one_year",
  "two_years",
  "three_years",
  "five_years",
  "ten_years",
  "since_buy",
  "max",
];

function timeframeRank(entry: unknown) {
  const key = String(entry ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();
  const rank = TIMEFRAME_ORDER.indexOf(key);
  return rank < 0 ? TIMEFRAME_ORDER.length : rank;
}

/** Sorts performance records by their `timeframe` from the shortest to the longest period. The sort is stable. */
export function sortByTimeframe(entries: Rec[]): Rec[] {
  return entries
    .map((entry, index) => ({ entry, index, rank: timeframeRank(pick(entry, ["timeframe"])) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ entry }) => entry);
}

/** `where` is the text shown to the user; `view` is the page its link opens. */
type ToolUsage = { category: string; feature: string; where: string; view: View };

/** Which part of the app uses each Scalable MCP tool. Every tool has a feature behind it. */
export const TOOL_USAGE: Record<string, ToolUsage> = {
  ping: { category: "Connection", feature: "Connection test", where: "Settings → Scalable tools → Test connection", view: "settings" },
  list_accessible_portfolios: { category: "Portfolio", feature: "Portfolio list", where: "Loaded at start for every page", view: "overview" },
  get_portfolio_holdings: { category: "Portfolio", feature: "Holdings table", where: "Portfolio", view: "portfolio" },
  get_portfolio_overview: { category: "Portfolio", feature: "Value and performance", where: "Overview, summary cards", view: "overview" },
  get_portfolio_cash_breakdown: { category: "Portfolio", feature: "Cash and buying power", where: "Overview, order dialog", view: "overview" },
  get_account_profile: { category: "Account", feature: "Account profile card and display name", where: "Overview, account menu", view: "overview" },
  get_overnight_summary: { category: "Account", feature: "Overnight summary card", where: "Overview", view: "overview" },
  list_overnight_transactions: { category: "Account", feature: "Overnight transactions", where: "Overview", view: "overview" },
  list_fixed_term_accounts: { category: "Account", feature: "Fixed-term accounts list", where: "Overview", view: "overview" },
  get_fixed_term_account: { category: "Account", feature: "Fixed-term account details", where: "Overview → Details", view: "overview" },
  list_watchlist_items: { category: "Watchlist", feature: "Watchlist table", where: "Watchlist", view: "watchlist" },
  add_watchlist_item: { category: "Watchlist", feature: "Add to watchlist", where: "Discover, Screener, security details", view: "discover" },
  remove_watchlist_item: { category: "Watchlist", feature: "Remove from watchlist", where: "Watchlist rows, security details", view: "watchlist" },
  get_security_quote: { category: "Market data", feature: "Prices and day change", where: "All tables", view: "portfolio" },
  get_security_chart: { category: "Market data", feature: "Price chart", where: "Security details → Chart", view: "portfolio" },
  get_security_news: { category: "Market data", feature: "News", where: "Security details → News", view: "portfolio" },
  list_order_venues: { category: "Market data", feature: "Trading venues", where: "Security details → Venues", view: "portfolio" },
  search_securities: { category: "Market data", feature: "Security search", where: "Discover, order dialog", view: "discover" },
  search_derivatives: { category: "Market data", feature: "Derivatives search", where: "Discover → Derivatives", view: "discover" },
  list_portfolio_groups: { category: "Groups", feature: "Groups list and performance", where: "Groups, Overview, Filters", view: "groups" },
  get_portfolio_group: { category: "Groups", feature: "Group details", where: "Groups → Details", view: "groups" },
  create_portfolio_group: { category: "Groups", feature: "Create group", where: "Groups → New group", view: "groups" },
  upsert_portfolio_group: { category: "Groups", feature: "Rename / edit group", where: "Groups → Rename", view: "groups" },
  remove_portfolio_group: { category: "Groups", feature: "Delete group", where: "Groups → Delete", view: "groups" },
  add_portfolio_group_holdings: { category: "Groups", feature: "Add holdings to a group", where: "Groups → Add holdings, ungrouped list", view: "groups" },
  remove_portfolio_group_holdings: { category: "Groups", feature: "Remove holding from a group", where: "Groups → × on a holding", view: "groups" },
  list_price_alerts: { category: "Alerts", feature: "Price alerts list", where: "Alerts", view: "alerts" },
  create_price_alert: { category: "Alerts", feature: "Create price alert", where: "Alerts → New alert, security details", view: "alerts" },
  remove_price_alert: { category: "Alerts", feature: "Remove price alert", where: "Alerts", view: "alerts" },
  list_savings_plans: { category: "Savings plans", feature: "Savings plans list", where: "Savings plans", view: "savings" },
  get_savings_plan_config: { category: "Savings plans", feature: "Plan options", where: "Savings plans → Plan options", view: "savings" },
  preview_savings_plan: { category: "Savings plans", feature: "Preview a plan", where: "Savings plans → New plan, Edit", view: "savings" },
  submit_savings_plan: { category: "Savings plans", feature: "Create or change a plan", where: "Savings plans → confirm step", view: "savings" },
  remove_savings_plan: { category: "Savings plans", feature: "Remove a plan", where: "Savings plans", view: "savings" },
  list_portfolio_transactions: { category: "Orders", feature: "Transactions list", where: "Transactions", view: "transactions" },
  get_transaction_details: { category: "Orders", feature: "Transaction details", where: "Transactions → Details", view: "transactions" },
  cancel_order: { category: "Orders", feature: "Cancel open order", where: "Transactions → Cancel", view: "transactions" },
  preview_buy_order: { category: "Orders", feature: "Buy preview", where: "Order dialog", view: "portfolio" },
  preview_sell_order: { category: "Orders", feature: "Sell preview", where: "Order dialog", view: "portfolio" },
  submit_buy_order: { category: "Orders", feature: "Place buy order", where: "Order dialog", view: "portfolio" },
  submit_sell_order: { category: "Orders", feature: "Place sell order", where: "Order dialog", view: "portfolio" },
};

/** Tools the Rust backend calls itself (dashboard load, order dialog), so the UI never counts them. */
export const BACKEND_TOOLS = new Set([
  "list_accessible_portfolios",
  "get_portfolio_holdings",
  "get_portfolio_overview",
  "get_portfolio_cash_breakdown",
  "list_watchlist_items",
  "get_security_quote",
  "list_portfolio_groups",
  "preview_buy_order",
  "preview_sell_order",
  "preview_savings_plan",
  "submit_savings_plan",
  "submit_buy_order",
  "submit_sell_order",
  "search_securities",
]);

const SINCE_BUY_FRACTION = ["performance", "performancePercent", "simpleReturn", "return", "relativeReturn"];
const SINCE_BUY_ABSOLUTE = ["simpleAbsoluteReturn", "absoluteReturn", "absolute", "absoluteValue", "amount", "profit", "gain"];

function sinceBuyFigures(entry: unknown): { fraction: number | null; absolute: number | null } | null {
  const fraction = finiteNumber(pick(entry, SINCE_BUY_FRACTION));
  const absolute = finiteNumber(pick(entry, SINCE_BUY_ABSOLUTE));
  return fraction === null && absolute === null ? null : { fraction, absolute };
}

/** Finds the since-buy figures anywhere in a record: a `sinceBuy` object, or a list entry whose timeframe is "since buy". */
export function findSinceBuy(value: unknown, depth = 0): { fraction: number | null; absolute: number | null } | null {
  const parsed = parseMaybeJson(value);
  if (depth > 6 || parsed === null || typeof parsed !== "object") return null;
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const frame = pick(item, ["timeframe", "timeFrame", "period", "range", "type", "name"]);
      if (typeof frame === "string" && /^(sincebuy|sincepurchase|sinceacquisition|sincebuyin)$/.test(norm(frame))) {
        const figures = sinceBuyFigures(item);
        if (figures) return figures;
      }
    }
    for (const item of parsed) {
      const nested = findSinceBuy(item, depth + 1);
      if (nested) return nested;
    }
    return null;
  }
  for (const [key, child] of Object.entries(parsed)) {
    if (/^(sincebuy|sincepurchase|sinceacquisition|sincebuyin)$/.test(norm(key))) {
      const figures = sinceBuyFigures(parseMaybeJson(child));
      if (figures) return figures;
    }
  }
  for (const child of Object.values(parsed)) {
    const nested = findSinceBuy(child, depth + 1);
    if (nested) return nested;
  }
  return null;
}
