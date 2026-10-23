import type { Notice } from "./notifications";
import { ALIASES, isRec, pick, pickString, type Rec } from "./response";
import { formatDate } from "./format";
import { readStoredJson, writeStoredJson } from "./storage";

/** One price alert from `list_price_alerts`, reduced to what the trigger check needs. */
type PriceAlert = {
  id: string;
  name: string;
  isin?: string;
  direction?: "up" | "down";
  targetPrice?: string;
  /** ISO time Scalable reports for the moment the alert fired; set only once it has fired. */
  triggeredAt?: string;
};

export const ALERT_MINUTE_OPTIONS = [1, 2, 5, 10, 15, 30] as const;

const NOTIFIED_LIMIT = 1000;

function directionOf(value: unknown): PriceAlert["direction"] {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  if (text === "up" || text === "above") return "up";
  if (text === "down" || text === "below") return "down";
  return undefined;
}

/** Reads alert records; records without an id are dropped because they cannot be told apart. */
export function parseAlerts(records: Rec[]): PriceAlert[] {
  const alerts: PriceAlert[] = [];
  for (const record of records) {
    const id = pickString(record, ["alertId", "priceAlertId", "id"]);
    if (!id) continue;
    const instrument = isRec(record.instrument) ? record.instrument : {};
    alerts.push({
      id,
      name: pickString(instrument, ["name"]) ?? pickString(record, ["name"]) ?? pickString(instrument, ["identifier", "isin", "ticker"]) ?? "A security",
      isin: pickString(instrument, ["identifier", "isin"]) ?? pickString(record, ["isin"]),
      direction: directionOf(pick(record, ["direction"])),
      targetPrice: pickString(record, ALIASES.targetPrice),
      triggeredAt: pickString(record, ["triggeredTimestampUtc", "triggeredTimestamp", "triggeredAt"]),
    });
  }
  return alerts;
}

export type AlertFilter = { text: string; direction: "" | "up" | "down"; status: "" | "active" | "triggered" };

export const NO_ALERT_FILTER: AlertFilter = { text: "", direction: "", status: "" };

export function isAlertFiltering(filter: AlertFilter) {
  return filter.text.trim() !== "" || filter.direction !== "" || filter.status !== "";
}

/** Whether an alert record passes the filter: `text` matches the symbol (ISIN) or name. */
export function matchesAlert(record: Rec, filter: AlertFilter): boolean {
  const [alert] = parseAlerts([{ ...record, id: pickString(record, ["alertId", "priceAlertId", "id"]) ?? "alert" }]);
  if (!alert) return false;
  const text = filter.text.trim().toLowerCase();
  if (text !== "" && ![alert.isin, alert.name].some((value) => value?.toLowerCase().includes(text))) return false;
  if (filter.direction !== "" && alert.direction !== filter.direction) return false;
  if (filter.status !== "" && isTriggered(alert) !== (filter.status === "triggered")) return false;
  return true;
}

function isTriggered(alert: PriceAlert) {
  return alert.triggeredAt !== undefined;
}

/** Fired alerts that were not announced yet, oldest first. */
function newlyTriggered(alerts: PriceAlert[], notified: ReadonlySet<string>): PriceAlert[] {
  return alerts.filter((alert) => isTriggered(alert) && !notified.has(alert.id)).sort((a, b) => (a.triggeredAt ?? "").localeCompare(b.triggeredAt ?? ""));
}

function describe(alert: PriceAlert) {
  const move = alert.direction === "up" ? "rose to" : alert.direction === "down" ? "fell to" : "reached";
  return alert.targetPrice ? `${alert.name} ${move} ${alert.targetPrice}` : `${alert.name} reached its alert price`;
}

/** Title and text for the desktop notification. */
export function alertMessage(alerts: PriceAlert[]): { title: string; body: string } {
  if (alerts.length === 1) return { title: "Price alert triggered", body: describe(alerts[0]) };
  const lines = alerts.slice(0, 5).map(describe);
  if (alerts.length > lines.length) lines.push(`and ${alerts.length - lines.length} more`);
  return { title: `${alerts.length} price alerts triggered`, body: lines.join("\n") };
}

/** One notification per fired alert: what it reached and when Scalable says it fired. */
export function alertNotices(alerts: PriceAlert[]): Notice[] {
  return alerts.map((alert) => {
    const when = alert.triggeredAt ? new Date(alert.triggeredAt) : null;
    return {
      kind: "info" as const,
      title: "Price alert triggered",
      text: describe(alert),
      detail: when && !Number.isNaN(when.getTime()) ? `Triggered ${formatDate(when, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : undefined,
    };
  });
}

/** Ids already announced, or null when this app never checked before. */
export function loadNotified(): Set<string> | null {
  const parsed = readStoredJson("alerts-notified");
  if (parsed === null) return null;
  return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
}

export function saveNotified(ids: ReadonlySet<string>) {
  writeStoredJson("alerts-notified", [...ids].slice(-NOTIFIED_LIMIT));
}

/**
 * One check. The first check ever only records what has fired already, so old alerts do not
 * flood the screen; later checks announce every alert that fired since, even while the app was closed.
 */
export function checkAlerts(alerts: PriceAlert[], notified: ReadonlySet<string> | null): { announce: PriceAlert[]; notified: Set<string> } {
  const next = new Set(notified ?? []);
  const announce = notified === null ? [] : newlyTriggered(alerts, notified);
  for (const alert of alerts) if (isTriggered(alert)) next.add(alert.id);
  return { announce, notified: next };
}
