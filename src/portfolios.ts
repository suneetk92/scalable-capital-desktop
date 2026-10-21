import { isRec, parseMaybeJson, pick, type Rec } from "./response";
import type { PagePortfolio } from "./types";

const FLAG_KEYS = ["isMain", "main", "isMainPortfolio", "isDefault", "default", "isPrimary", "primary"];
const KIND_KEYS = ["type", "kind", "portfolioType", "category", "role"];

/** Whether a `list_accessible_portfolios` record is marked as the main portfolio. The shape is not published, so this checks the usual flags. */
export function isMainPortfolio(record: unknown): boolean {
  const parsed = parseMaybeJson(record);
  if (!isRec(parsed)) return false;
  if (pick(parsed, FLAG_KEYS) === true) return true;
  const kind = pick(parsed, KIND_KEYS);
  return typeof kind === "string" && /^(main|primary|default)$/i.test(kind.trim());
}

/** Portfolios for pages and forms, with the main one first (the first one when none is marked). */
export function pagePortfolios(snapshots: { portfolioId: string; name: string; portfolio: unknown }[]): PagePortfolio[] {
  const main = snapshots.findIndex((snapshot) => isMainPortfolio(snapshot.portfolio as Rec));
  const ordered = main > 0 ? [snapshots[main], ...snapshots.filter((_, index) => index !== main)] : snapshots;
  return ordered.map(({ portfolioId, name }) => ({ portfolioId, name }));
}
