import { isRec } from "./response";
import { parseDecimal } from "./format";

/** A trailing stop loss the app watches itself: Scalable's MCP has no such order. See `src-tauri/src/mcp/trailing/`. */
export type TrailKind = "percent" | "amount";
export type TrailingStatus = "active" | "selling" | "sold" | "attention";

export type TrailingStop = {
  id: string;
  isin: string;
  name: string;
  portfolioId: string | null;
  quantity: number;
  trail: { kind: TrailKind; value: number };
  startPrice: number;
  high: number;
  lastPrice: number | null;
  status: TrailingStatus;
  message: string | null;
  createdAt: number;
};

export type TrailingList = { stops: TrailingStop[]; problem: string | null; cycleStartedAt: number | null };

export const STATUS_LABEL: Record<TrailingStatus, string> = {
  active: "Watching",
  selling: "Selling",
  sold: "Sold",
  attention: "Needs you",
};

/** How much of the distance between the high and the trigger is left: 1 at the high, 0 at the trigger. */
export function triggerMargin(price: number, high: number, trail: TrailingStop["trail"]): number {
  const trigger = triggerPrice(high, trail);
  return high > trigger ? Math.max(0, Math.min(1, (price - trigger) / (high - trigger))) : 0;
}

/** The price at or below which the stop sells. */
export function triggerPrice(high: number, trail: TrailingStop["trail"]): number {
  return trail.kind === "percent" ? high * (1 - trail.value / 100) : high - trail.value;
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
    id: value.id,
    isin: value.isin,
    name: typeof value.name === "string" ? value.name : value.isin,
    portfolioId: typeof value.portfolioId === "string" ? value.portfolioId : null,
    quantity: value.shares, // the backend stores the amount as `shares`
    trail: { kind: value.trail.kind === "amount" ? "amount" : "percent", value: value.trail.value },
    startPrice: typeof value.startPrice === "number" ? value.startPrice : value.high,
    high: value.high,
    lastPrice: typeof value.lastPrice === "number" ? value.lastPrice : null,
    status,
    message: typeof value.message === "string" ? value.message : null,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
  };
}

/** The answer of `list_trailing_stops`, kept only as far as it has the expected shape. */
export function parseTrailingList(payload: unknown): TrailingList {
  if (!isRec(payload)) return { stops: [], problem: null, cycleStartedAt: null };
  const stops = (Array.isArray(payload.stops) ? payload.stops : []).map(toStop).filter((stop): stop is TrailingStop => stop !== null);
  return { stops, problem: typeof payload.problem === "string" ? payload.problem : null, cycleStartedAt: typeof payload.cycleStartedAt === "number" ? payload.cycleStartedAt : null };
}
