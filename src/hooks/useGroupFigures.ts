import { useMemo } from "react";
import { withGroupExtras, type GroupExtras } from "../groupFigures";
import type { SecurityGroup } from "../groups";
import { planOf } from "../savingsPlan";
import { useToolQuery } from "../toolActions";
import type { ToolActions } from "../toolActions";
import type { PagePortfolio } from "../types";
import type { Invoke, ToolDef } from "../tools";
import { dedupeRows, isOpenOrder, transactionIsin, type TransactionRow } from "../transactions";
import { collect, perPortfolio } from "../pages/shared";
import { TOOL } from "../commands";

/**
 * The groups with the open orders and savings plan amounts Scalable does not report, worked out from the plan list and
 * from `transactions`, the whole history the transaction sync holds (null while it is not known).
 */
export function useGroupFigures({
  invoke,
  defs,
  actions,
  portfolios,
  reloadKey,
  transactions,
  groups,
  defaultGroup,
}: {
  invoke: Invoke;
  defs: ToolDef[];
  actions: ToolActions;
  portfolios: PagePortfolio[];
  reloadKey: unknown;
  transactions: TransactionRow[] | null;
  groups: SecurityGroup[];
  defaultGroup: SecurityGroup | null;
}) {
  const wanted = groups.length > 0 || defaultGroup !== null;
  const planQuery = useToolQuery(invoke, defs, TOOL.listSavingsPlans, wanted && actions.has(TOOL.listSavingsPlans) ? perPortfolio(portfolios) : null, reloadKey);

  const extras = useMemo((): GroupExtras => {
    const loaded = (entries: { outcome: { ok: boolean } }[]) => entries.length > 0 && entries.every((entry) => entry.outcome.ok);
    const orders: GroupExtras["orders"] = transactions
      ? dedupeRows(transactions)
          .filter((row) => isOpenOrder(row.record))
          .map((row) => ({ portfolioId: row.portfolioId, item: { isin: transactionIsin(row.record) } }))
      : null;
    let plans: GroupExtras["plans"] = null;
    if (loaded(planQuery.entries)) {
      const { records, portfolioOf } = collect(planQuery.entries);
      plans = records.map((record) => ({ portfolioId: portfolioOf.get(record) ?? "", item: planOf(record) }));
    }
    return { orders, plans };
  }, [transactions, planQuery.entries]);

  return useMemo(() => {
    const filled = groups.map((group) => withGroupExtras(group, extras));
    const filledDefault = defaultGroup ? withGroupExtras(defaultGroup, extras) : null;
    return { groups: filled, defaultGroup: filledDefault, allGroups: filledDefault ? [...filled, filledDefault] : filled };
  }, [groups, defaultGroup, extras]);
}
