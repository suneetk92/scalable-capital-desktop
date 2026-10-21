import type { ScreenerRow } from "./screener";

type Position = {
  rowId: string;
  name: string;
  isin: string;
  quantity: number | null;
  lastPrice: number | null;
  /** Average buy price per share, or null when it cannot be worked out. */
  avgPrice: number | null;
  /** What the position cost in total, or null when Scalable gave no cost for the holding. */
  cost: number | null;
  value: number;
  /** Share of the total market value, 0 to 1. */
  weight: number;
  /** Gain or loss since buy in money, or null when Scalable gave no cost for the holding. */
  gain: number | null;
  /** The gain as a fraction of the cost, or null when it cannot be worked out. */
  gainFraction: number | null;
  /** The move today in money, from the change %. */
  today: number | null;
};

type HoldingsSummary = {
  currency: string;
  mixedCurrencies: boolean;
  /** Holdings with a market value; the figures below are over these. */
  count: number;
  value: number;
  /** Holdings whose cost is known (they report a since-buy gain). */
  withCost: number;
  cost: number;
  gain: number;
  gainFraction: number | null;
  today: number;
  todayFraction: number | null;
  /** Share of the value held by the five largest positions, 0 to 1. */
  topFiveShare: number;
  /** Biggest position first. */
  positions: Position[];
  best: Position | null;
  worst: Position | null;
};

/** Worth of a row's change today in money: the value now minus the value before a move of `change` percent. */
function todayOf(value: number, change: number | null): number | null {
  if (change === null || !Number.isFinite(change) || change <= -100) return null;
  return value - value / (1 + change / 100);
}

/** Totals and a position list worked out from the holdings already loaded; rows without a value are left out. */
export function summarizeHoldings(rows: ScreenerRow[], fallbackCurrency = "EUR"): HoldingsSummary {
  const valued = rows.filter((row): row is ScreenerRow & { value: number } => row.value !== null && Number.isFinite(row.value) && row.value > 0);
  const value = valued.reduce((sum, row) => sum + row.value, 0);
  const positions: Position[] = valued
    .map((row) => ({
      rowId: row.rowId,
      name: row.name || row.symbol,
      isin: row.isin,
      quantity: row.quantity,
      lastPrice: row.lastPrice,
      avgPrice: row.avgPrice ?? null,
      cost: row.cost ?? null,
      value: row.value,
      weight: value > 0 ? row.value / value : 0,
      gain: row.sinceBuy ?? null,
      gainFraction: row.sinceBuyPct == null ? null : row.sinceBuyPct / 100,
      today: todayOf(row.value, row.change),
    }))
    .sort((a, b) => b.value - a.value);

  const known = positions.filter((position) => position.gain !== null);
  const gain = known.reduce((sum, position) => sum + (position.gain ?? 0), 0);
  const cost = known.reduce((sum, position) => sum + position.value - (position.gain ?? 0), 0);
  const withToday = positions.filter((position) => position.today !== null);
  const today = withToday.reduce((sum, position) => sum + (position.today ?? 0), 0);
  const todayBase = withToday.reduce((sum, position) => sum + position.value - (position.today ?? 0), 0);
  const ranked = positions.filter((position) => position.gainFraction !== null).sort((a, b) => (b.gainFraction ?? 0) - (a.gainFraction ?? 0));

  return {
    currency: valued[0]?.currency || fallbackCurrency,
    mixedCurrencies: new Set(valued.map((row) => row.currency)).size > 1,
    count: positions.length,
    value,
    withCost: known.length,
    cost,
    gain,
    gainFraction: cost > 0 ? gain / cost : null,
    today,
    todayFraction: todayBase > 0 ? today / todayBase : null,
    topFiveShare: positions.slice(0, 5).reduce((sum, position) => sum + position.weight, 0),
    positions,
    best: ranked[0] ?? null,
    worst: ranked.length > 1 ? (ranked[ranked.length - 1] ?? null) : null,
  };
}
