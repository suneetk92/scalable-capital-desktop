import { TOOL } from "./commands";
import { findSinceBuy } from "./tools";
import { isRec, parseMaybeJson, pick, pickNumber, pickString, type Rec } from "./response";
import { readStoredJson } from "./storage";

type GroupHolding = { isin: string; name: string; type: string };

export type SecurityGroup = {
  id: string;
  name: string;
  description: string;
  portfolioId: string;
  isins: string[];
  portfolioIds: string[];
  holdings: GroupHolding[];
  valuation: number | null;
  currency: string;
  sinceBuyPerformance: number | null;
  sinceBuyAbsolute: number | null;
  pendingOrders: number | null;
  savingsPlansAmount: number | null;
  /** The built-in group of holdings that are in no group. It cannot be renamed, deleted or added to. */
  isDefault?: boolean;
};

type Ungrouped = { portfolioId: string; holdings: GroupHolding[] };

export type GroupData = {
  groups: SecurityGroup[];
  ungrouped: Ungrouped[];
  canCreate: boolean | null;
};

const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

function holdingFrom(item: unknown): GroupHolding | null {
  if (typeof item === "string") return ISIN_PATTERN.test(item) ? { isin: item, name: item, type: "" } : null;
  if (!isRec(item)) return null;
  const isin = pickString(item, ["isin", "securityId"]);
  if (!isin) return null;
  return { isin, name: pickString(item, ["name", "securityName"]) ?? isin, type: pickString(item, ["securityType", "type"]) ?? "" };
}

function holdingList(value: unknown): GroupHolding[] {
  const list = parseMaybeJson(value);
  return Array.isArray(list) ? list.map(holdingFrom).filter((item): item is GroupHolding => item !== null) : [];
}

function deepIsins(value: unknown, found: Set<string>, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return;
  if (typeof value === "string") {
    if (ISIN_PATTERN.test(value)) found.add(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => deepIsins(item, found, depth + 1));
  } else if (isRec(value)) {
    Object.values(value).forEach((item) => deepIsins(item, found, depth + 1));
  }
}

function groupFrom(item: Rec, portfolioId: string): SecurityGroup | null {
  const name = pickString(item, ["name", "groupName", "title", "label", "displayName"]);
  const id = pickString(item, ["groupId", "id"]);
  if (!name || !id) return null;
  let holdings = holdingList(pick(item, ["holdings", "securities", "positions", "members"]));
  const isins = new Set(holdings.map((holding) => holding.isin));
  if (holdings.length === 0) {
    deepIsins(item, isins);
    holdings = [...isins].map((isin) => ({ isin, name: isin, type: "" }));
  }
  const performance = pick(item, ["performance"]);
  // The holdings lists are left out: a holding's own figure is not the group's.
  const own = Object.fromEntries(Object.entries(item).filter(([key]) => !/^(holdings|securities|positions|members)$/i.test(key)));
  const sinceBuy = findSinceBuy(own);
  const valuation = pickNumber(performance, ["valuation"]) ?? pickNumber(item, ["valuation", "totalValuation", "value"]);
  const fraction = sinceBuy?.fraction ?? null;
  const reported = sinceBuy?.absolute ?? null;
  // Only a percentage reported: the money gain follows from the value.
  const absolute = reported ?? (valuation !== null && fraction !== null && fraction > -1 ? valuation - valuation / (1 + fraction) : null);
  return {
    id,
    name,
    description: pickString(item, ["description"]) ?? "",
    portfolioId: pickString(item, ["portfolioId"]) ?? portfolioId,
    isins: [...isins],
    portfolioIds: [],
    holdings,
    valuation,
    currency: isRec(performance) ? (pickString(performance, ["currency"]) ?? "EUR") : "EUR",
    sinceBuyPerformance: fraction,
    sinceBuyAbsolute: absolute,
    pendingOrders: pickNumber(item, ["pendingOrderCount"]),
    savingsPlansAmount: pickNumber(item, ["savingsPlansAmount"]),
  };
}

/** Reads the answers of the portfolio group tools (`list_portfolio_groups`, one entry per portfolio). */
export function parseGroupData(raw: Record<string, unknown> | undefined): GroupData {
  const groups: SecurityGroup[] = [];
  const ungrouped: Ungrouped[] = [];
  let canCreate: boolean | null = null;
  const seen = new Set<string>();
  for (const [key, original] of Object.entries(raw ?? {})) {
    if (key.endsWith(":error")) continue;
    const value = parseMaybeJson(original);
    const container: Rec | null = Array.isArray(value) ? { items: value } : isRec(value) ? value : null;
    if (!container) continue;
    const portfolioId = pickString(container, ["portfolioId"]) ?? key.split(":")[1] ?? "";
    const create = pick(container, ["canCreateAdditionalGroup"]);
    if (typeof create === "boolean") canCreate = canCreate === null ? create : canCreate && create;
    const items = parseMaybeJson(pick(container, ["items", "groups", "portfolioGroups"]));
    const candidates: unknown[] = Array.isArray(items) ? items : isRec(container) && pick(container, ["groupId"]) ? [container] : [];
    for (const item of candidates) {
      if (!isRec(item)) continue;
      const group = groupFrom(item, portfolioId);
      if (group && !seen.has(group.id)) {
        seen.add(group.id);
        groups.push(group);
      }
    }
    const loose = holdingList(pick(container, ["ungroupedHoldings", "ungrouped_holdings", "ungroupedItems", "ungrouped_items", "ungrouped"]));
    if (loose.length > 0) ungrouped.push({ portfolioId, holdings: loose });
  }
  return { groups, ungrouped, canCreate };
}

export const UNGROUPED_ID = "__ungrouped";

/** The default group: every holding Scalable lists as ungrouped, across portfolios. Null when there are none. */
export function ungroupedGroup(data: GroupData): SecurityGroup | null {
  const holdings = data.ungrouped.flatMap((entry) => entry.holdings);
  if (holdings.length === 0) return null;
  const portfolioIds = [...new Set(data.ungrouped.map((entry) => entry.portfolioId).filter((id) => id !== ""))];
  return {
    id: UNGROUPED_ID,
    name: "Default",
    description: "Holdings that are not in any group",
    portfolioId: portfolioIds.length === 1 ? portfolioIds[0] : "",
    isins: holdings.map((holding) => holding.isin),
    portfolioIds: [],
    holdings,
    valuation: null,
    currency: "EUR",
    sinceBuyPerformance: null,
    sinceBuyAbsolute: null,
    pendingOrders: null,
    savingsPlansAmount: null,
    isDefault: true,
  };
}

/** The group ids in the order the user dragged them to (kept on this computer only). */
export function loadGroupOrder(): string[] {
  const saved = readStoredJson("group-order");
  const ids = Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string" && id !== "") : [];
  return ids.filter((id, index) => ids.indexOf(id) === index);
}

/** The groups in the saved order; groups the order does not know yet follow in Scalable's order. */
export function orderGroups<T extends { id: string }>(groups: T[], order: readonly string[]): T[] {
  if (order.length === 0) return groups;
  const byId = new Map(groups.map((group) => [group.id, group]));
  const ordered = order.flatMap((id) => byId.get(id) ?? []);
  const placed = new Set(ordered);
  return [...ordered, ...groups.filter((group) => !placed.has(group))];
}

/**
 * Whether a holding can be moved from one group to another. `null` (or the Default group) stands for "in no group":
 * moving there only removes the holding from its group, moving from there only adds it to the target.
 */
export function canMoveHolding(row: { isin: string; portfolioId: string }, from: SecurityGroup | null, to: SecurityGroup | null, offered: (tool: string) => boolean): boolean {
  const source = from && !from.isDefault ? from : null;
  const target = to && !to.isDefault ? to : null;
  if (row.isin === "" || (!source && !target) || (source && target && source.id === target.id)) return false;
  if (target) {
    if (target.portfolioId !== "" && row.portfolioId !== "" && target.portfolioId !== row.portfolioId) return false;
    const added = target.isins.includes(row.isin);
    if (added ? !source : !offered(TOOL.addPortfolioGroupHoldings)) return false;
  }
  return !source || offered(TOOL.removePortfolioGroupHoldings);
}
