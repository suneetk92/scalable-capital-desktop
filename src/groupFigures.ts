import type { SecurityGroup } from "./groups";
import type { ExistingPlan } from "./savingsPlan";
import { parseDecimal } from "./format";

/** An open order or a savings plan, with the portfolio it belongs to. */
type Positioned<T> = { portfolioId: string; item: T };

type OpenOrder = { isin: string | null };

/** What is known about orders and plans. A list that could not be loaded is null, so its figures stay unknown. */
export type GroupExtras = {
  orders: Positioned<OpenOrder>[] | null;
  plans: Positioned<ExistingPlan>[] | null;
};

const inGroup = (group: SecurityGroup, portfolioId: string, isin: string | null) =>
  isin !== null && group.isins.includes(isin) && (group.portfolioId === "" || portfolioId === "" || group.portfolioId === portfolioId);

/** Fills the open order count and the savings plan amount that Scalable does not report (it gives none for the default group). */
export function withGroupExtras(group: SecurityGroup, { orders, plans }: GroupExtras): SecurityGroup {
  const pendingOrders = group.pendingOrders ?? (orders ? orders.filter((entry) => inGroup(group, entry.portfolioId, entry.item.isin)).length : null);
  const planned = plans ? plans.filter((entry) => inGroup(group, entry.portfolioId, entry.item.isin)) : null;
  const savingsPlansAmount = group.savingsPlansAmount ?? (planned ? planned.reduce((sum, entry) => sum + (parseDecimal(entry.item.amount) ?? 0), 0) : null);
  return { ...group, pendingOrders, savingsPlansAmount };
}
