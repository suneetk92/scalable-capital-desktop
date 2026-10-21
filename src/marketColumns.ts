export const MARKET_CURRENCY = "EUR";
const SCALABLE_GROUP = "From Scalable";

type CellFormat = "text" | "price" | "bigMoney" | "percent" | "number" | "integer" | "compact" | "date" | "dateYmd" | "term" | "bool" | (string & {});
export type Tone = "" | "up" | "down" | "muted";
export type MarketRecord = Record<string, unknown>;
export type Cell = { text: string; tone: Tone };

export type TableColumn = {
  id: string;
  label: string;
  group: string;
  source: string;
  field: string;
  format: CellFormat;
  signed?: boolean;
  hint?: string;
  screenerOnly?: boolean;
  settings?: unknown;
  values?: Record<string, string>;
  name?: string;
  alias?: string;
  labels?: Readonly<Record<string, string>>;
  text?: boolean;
};

const scalable = (id: string, label: string, hint: string): TableColumn => ({ id, label, group: SCALABLE_GROUP, source: "scalable", field: "", format: "text", hint });

const TABLE_COLUMNS: TableColumn[] = [
  scalable("price", "Price", "Last price from Scalable, in the listing currency"),
  scalable("change", "Chg %", "Day change in percent, from Scalable"),
  scalable("quantity", "Quantity", "Shares you hold (portfolio only)"),
  scalable("value", "Market value", "Value of your position"),
  scalable("avgPrice", "Avg price", "Average buy price per share (portfolio only)"),
  scalable("cost", "Total cost", "What the position cost you in total"),
  scalable("sinceBuy", "Gain/loss", "Gain or loss since buy in money"),
  scalable("sinceBuyPct", "Gain/loss %", "Gain or loss since buy in percent of the cost"),
  scalable("weight", "Share", "Share of your total market value (portfolio only)"),
  scalable("today", "Today", "Price change today in money, from the change %"),
  scalable("exchange", "Type", "Security type"),
];

export const DEFAULT_COLUMNS = ["price", "change"];

const BY_ID = new Map(TABLE_COLUMNS.map((column) => [column.id, column]));

export const baseColumnId = (id: string) => id.split(":")[0] ?? id;

export function columnById(id: string): TableColumn | undefined {
  return BY_ID.get(id);
}

export function columnGroups(): { group: string; columns: TableColumn[] }[] {
  return [{ group: SCALABLE_GROUP, columns: TABLE_COLUMNS }];
}

export function sanitizeColumns(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_COLUMNS];
  const seen = new Set<string>();
  return raw.filter((id): id is string => typeof id === "string" && !seen.has(id) && Boolean(seen.add(id)));
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function marketSortValue(column: TableColumn, record: MarketRecord | undefined): number | string | null {
  const raw = record?.[column.field];
  if (column.format === "text") return typeof raw === "string" && raw !== "" ? (column.labels?.[raw] ?? raw) : null;
  if (typeof raw === "boolean") return raw ? 1 : 0;
  return numeric(raw);
}

export function exportValue(column: TableColumn, record: MarketRecord | undefined): string | number | null {
  const raw = record?.[column.field];
  if (typeof raw === "string") return column.labels?.[raw] ?? raw;
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  return numeric(raw);
}
