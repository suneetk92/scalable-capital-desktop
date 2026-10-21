import { humanize } from "./tools";
import { isRec, pickString, type Rec } from "./response";
import { formatDate } from "./format";
import { TOOL } from "./commands";

type NoticeKind = "ok" | "error" | "info";

/** What a caller reports. `title` replaces the generic one of the kind, `detail` is a second, smaller line. */
export type Notice = { kind: NoticeKind; text: string; title?: string; detail?: string };

export type NotificationItem = Notice & { id: number; at: number };

export const NOTIFICATION_LIMIT = 50;

/** Adds a notice as the newest item and drops the oldest beyond the limit. */
export function addNotification(items: NotificationItem[], notice: Notice, id: number, at: number): NotificationItem[] {
  return [{ ...notice, id, at }, ...items].slice(0, NOTIFICATION_LIMIT);
}

export function removeNotification(items: NotificationItem[], id: number): NotificationItem[] {
  return items.filter((item) => item.id !== id);
}

/** "just now", "5 min ago", "3 h ago", then the date. */
export function formatAge(at: number, now: number) {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatDate(at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

type AlertFacts = { name?: string; price?: string; direction?: "up" | "down" };

function subject(facts: AlertFacts) {
  return facts.name ?? "A security";
}

function level(facts: AlertFacts) {
  const side = facts.direction === "up" ? "above" : facts.direction === "down" ? "below" : "";
  return facts.price ? `at ${facts.price}${side ? ` (${side})` : ""}` : "";
}

/** Text for an alert that was just set up. */
export function alertAddedNotice(facts: AlertFacts): Notice {
  const where = level(facts);
  return { kind: "ok", title: "Price alert added", text: where ? `${subject(facts)} · alert ${where}` : `${subject(facts)} · alert added` };
}

/** Text for an alert that was just removed. */
export function alertRemovedNotice(facts: AlertFacts): Notice {
  const where = level(facts);
  return { kind: "ok", title: "Price alert removed", text: where ? `${subject(facts)} · alert ${where} removed` : `${subject(facts)} · alert removed` };
}

/** The security a create call was for: a name from the answer when there is one, else the ISIN or ticker that was sent. */
function instrumentLabel(args: Rec, result: unknown): string | undefined {
  const instrument = isRec(args.instrument) ? args.instrument : {};
  const answered = isRec(result) ? pickString(isRec(result.instrument) ? result.instrument : result, ["name"]) : undefined;
  return answered ?? pickString(instrument, ["isin", "ticker"]) ?? pickString(args, ["isin"]);
}

/** Message after a tool of the runner dialog succeeded, with the details of what changed where it is known. */
export function toolSuccessNotice(tool: string, args: Rec, result: unknown): Notice {
  if (tool === TOOL.createPriceAlert) {
    return alertAddedNotice({ name: instrumentLabel(args, result), price: pickString(args, ["price"]) });
  }
  if (tool === "remove_price_alert") {
    const id = pickString(args, ["alertId"]);
    return { kind: "ok", title: "Price alert removed", text: id ? `Alert ${id} removed` : "Alert removed" };
  }
  return { kind: "ok", text: `${humanize(tool)} done.` };
}
