import { ArrowsRightLeftIcon, BanknotesIcon, BellAlertIcon, Cog6ToothIcon, MagnifyingGlassCircleIcon, RectangleGroupIcon, Squares2X2Icon, StarIcon, TableCellsIcon } from "@heroicons/react/24/outline";
import { readStoredJson } from "./storage";

export type CoreView = "overview" | "portfolio" | "watchlist" | "groups" | "discover" | "alerts" | "savings" | "transactions" | "settings";
/** A core page, or the id of a page an extension adds. */
export type View = CoreView | (string & {});

export type NavId = View;
const DEFAULT_NAV_ORDER: CoreView[] = ["overview", "portfolio", "watchlist", "groups", "discover", "alerts", "savings", "transactions", "settings"];

export function loadNavOrder(extensionViews: readonly { id: NavId; after: NavId }[] = []): NavId[] {
  const saved = readStoredJson("nav-order");
  const known = Array.isArray(saved) ? (saved.filter((id): id is NavId => typeof id === "string") as NavId[]) : [];
  const unique = known.filter((id, index) => known.indexOf(id) === index);
  const defaults: NavId[] = [...DEFAULT_NAV_ORDER];
  for (const view of extensionViews) {
    const index = defaults.indexOf(view.after);
    defaults.splice(index < 0 ? defaults.length : index + 1, 0, view.id);
  }
  return [...unique, ...defaults.filter((id) => !unique.includes(id))];
}

export function moveItem<T>(list: T[], from: T, to: T): T[] {
  const fromIndex = list.indexOf(from);
  const toIndex = list.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return list;
  const next = [...list];
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, from);
  return next;
}

export const VIEW_TITLES: Record<CoreView, string> = {
  overview: "Overview",
  portfolio: "Portfolio",
  watchlist: "Watchlist",
  groups: "Groups",
  discover: "Discover",
  alerts: "Price alerts",
  savings: "Savings plans",
  transactions: "Transactions",
  settings: "Settings",
};
export const VIEW_DESCRIPTIONS: Record<CoreView, string> = {
  overview: "Your account at a glance: performance, cash and groups.",
  portfolio: "Your holdings across all portfolios, split by Scalable group.",
  watchlist: "Securities you are keeping an eye on.",
  groups: "Bundle holdings into Scalable groups and follow them together.",
  discover: "Search Scalable’s securities and derivatives.",
  alerts: "Get notified when a security reaches a price.",
  savings: "Recurring purchases that run on a schedule.",
  transactions: "Orders and cash movements as Scalable reports them, with ISIN, name and a link to the security details.",
  settings: "Appearance, data, session, trading and the Scalable tools.",
};

export const NAV_ITEMS: Record<CoreView, { label: string; icon: typeof StarIcon }> = {
  overview: { label: "Overview", icon: Squares2X2Icon },
  portfolio: { label: "Portfolio", icon: TableCellsIcon },
  watchlist: { label: "Watchlist", icon: StarIcon },
  groups: { label: "Groups", icon: RectangleGroupIcon },
  discover: { label: "Discover", icon: MagnifyingGlassCircleIcon },
  alerts: { label: "Price alerts", icon: BellAlertIcon },
  savings: { label: "Savings plans", icon: BanknotesIcon },
  transactions: { label: "Transactions", icon: ArrowsRightLeftIcon },
  settings: { label: "Settings", icon: Cog6ToothIcon },
};

/** Counts shown next to some nav entries; they depend on the loaded data. */
export type NavCounts = Partial<Record<NavId, number | string>>;
