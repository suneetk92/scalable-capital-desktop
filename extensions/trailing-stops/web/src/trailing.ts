import { isRec } from "../../../../src/response";
import { parseDecimal } from "../../../../src/format";

/** A trailing stop loss (sells when the price falls) or trailing buy stop (buys when it rises) the app watches itself: Scalable's MCP has no such order. See `src-tauri/src/mcp/trailing/`. */
export type TrailKind = "percent" | "amount";
export type TrailSide = "sell" | "buy";
export type TrailingStatus = "active" | "selling" | "sold" | "attention";

export type TrailingStop = {
  side: TrailSide;
  id: string;
  isin: string;
  name: string;
  portfolioId: string | null;
  /** The shares to sell; 0 for a buy stop. */
  quantity: number;
  /** The money to spend; only for a buy stop. */
  amount: number | null;
  trail: { kind: TrailKind; value: number };
  startPrice: number;
  /** The extreme price seen: the highest for a stop loss, the lowest for a buy stop. */
  high: number;
  lastPrice: number | null;
  status: TrailingStatus;
  message: string | null;
  /** The price at which the stop was executed (only when status is 'sold'). */
  soldPrice: number | null;
  createdAt: number;
};

export type TrailingList = { stops: TrailingStop[]; problem: string | null; lastChecked: number | null };

const STATUS_LABEL: Record<TrailSide, Record<TrailingStatus, string>> = {
  sell: { active: "Watching", selling: "Selling", sold: "Sold", attention: "Needs you" },
  buy: { active: "Watching", selling: "Buying", sold: "Bought", attention: "Needs you" },
};

export function statusLabel(side: TrailSide, status: TrailingStatus): string {
  return STATUS_LABEL[side][status];
}

/** Bar fill: remaining margin for a sale, progress from the low toward the trigger for a purchase. */
export function triggerBarShare(price: number, extreme: number, trail: TrailingStop["trail"], side: TrailSide = "sell"): number {
  const trigger = triggerPrice(extreme, trail, side);
  const span = Math.abs(extreme - trigger);
  if (span === 0) return 0;
  const distance = side === "sell" ? price - trigger : price - extreme;
  return Math.max(0, Math.min(1, distance / span));
}

/** The price at or below which a stop loss sells, or at or above which a buy stop buys. */
export function triggerPrice(extreme: number, trail: TrailingStop["trail"], side: TrailSide = "sell"): number {
  const sign = side === "sell" ? -1 : 1;
  return trail.kind === "percent" ? extreme * (1 + (sign * trail.value) / 100) : extreme + sign * trail.value;
}

export function trailIssue(kind: TrailKind, distance: number | null): string | null {
  if (distance === null || distance <= 0) return "Enter a distance greater than zero.";
  if (kind === "percent" && distance >= 100) return "The distance must be below 100 %.";
  return null;
}

/** A typed number; a comma counts as the decimal point. */
export function decimal(text: string): number | null {
  return parseDecimal(text);
}

export function trailLabel(trail: TrailingStop["trail"], format: (value: number) => string): string {
  return trail.kind === "percent" ? `${trail.value} %` : format(trail.value);
}

function toStop(value: unknown): TrailingStop | null {
  if (!isRec(value) || typeof value.id !== "string" || typeof value.isin !== "string") return null;
  if (!isRec(value.trail) || typeof value.trail.value !== "number") return null;
  if (typeof value.shares !== "number" || typeof value.high !== "number") return null;
  const status = value.status;
  if (status !== "active" && status !== "selling" && status !== "sold" && status !== "attention") return null;
  return {
    side: value.side === "buy" ? "buy" : "sell",
    id: value.id,
    isin: value.isin,
    name: typeof value.name === "string" ? value.name : value.isin,
    portfolioId: typeof value.portfolioId === "string" ? value.portfolioId : null,
    quantity: value.shares, // the backend stores the amount as `shares`
    amount: typeof value.amount === "number" ? value.amount : null,
    trail: { kind: value.trail.kind === "amount" ? "amount" : "percent", value: value.trail.value },
    startPrice: typeof value.startPrice === "number" ? value.startPrice : value.high,
    high: value.high,
    lastPrice: typeof value.lastPrice === "number" ? value.lastPrice : null,
    status,
    message: typeof value.message === "string" ? value.message : null,
    soldPrice: typeof value.soldPrice === "number" ? value.soldPrice : null,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
  };
}

/** The answer of `list_trailing_stops`, kept only as far as it has the expected shape. */
export function parseTrailingList(payload: unknown): TrailingList {
  if (!isRec(payload)) return { stops: [], problem: null, lastChecked: null };
  const stops = (Array.isArray(payload.stops) ? payload.stops : []).map(toStop).filter((stop): stop is TrailingStop => stop !== null);
  return { stops, problem: typeof payload.problem === "string" ? payload.problem : null, lastChecked: typeof payload.lastChecked === "number" ? payload.lastChecked : null };
}
