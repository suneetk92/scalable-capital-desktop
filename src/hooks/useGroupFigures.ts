import { useMemo } from "react";
import { withGroupExtras, type GroupExtras } from "../groupFigures";
import type { SecurityGroup } from "../groups";
import { planOf } from "../savingsPlan";
import { useToolQuery } from "../toolActions";
import type { ToolActions } from "../toolActions";
import type { PagePortfolio } from "../types";
import type { Invoke, ToolDef } from "../tools";
import { isOpenOrder, transactionIsin } from "../transactions";
import { collect, perPortfolio } from "../pages/shared";
import { TOOL } from "../commands";

const ORDER_PAGE = { pageSize: 100 };

/** The groups with the open orders and savings plan amounts Scalable does not report, worked out from the order and plan lists. */
export function useGroupFigures({
  invoke,
  defs,
  actions,
  portfolios,
  reloadKey,
  groups,
  defaultGroup,
}: {
  invoke: Invoke;
  defs: ToolDef[];
  actions: ToolActions;
  portfolios: PagePortfolio[];
  reloadKey: unknown;
  groups: SecurityGroup[];
  defaultGroup: SecurityGroup | null;
}) {
  const wanted = groups.length > 0 || defaultGroup !== null;
  const orderQuery = useToolQuery(invoke, defs, TOOL.listPortfolioTransactions, wanted && actions.has(TOOL.listPortfolioTransactions) ? perPortfolio(portfolios, ORDER_PAGE) : null, reloadKey);
  const planQuery = useToolQuery(invoke, defs, TOOL.listSavingsPlans, wanted && actions.has(TOOL.listSavingsPlans) ? perPortfolio(portfolios) : null, reloadKey);

  const extras = useMemo((): GroupExtras => {
    const loaded = (entries: { outcome: { ok: boolean } }[]) => entries.length > 0 && entries.every((entry) => entry.outcome.ok);
    let orders: GroupExtras["orders"] = null;
    if (loaded(orderQuery.entries)) {
      const { records, portfolioOf } = collect(orderQuery.entries);
      orders = records.filter(isOpenOrder).map((record) => ({ portfolioId: portfolioOf.get(record) ?? "", item: { isin: transactionIsin(record) } }));
    }
    let plans: GroupExtras["plans"] = null;
    if (loaded(planQuery.entries)) {
      const { records, portfolioOf } = collect(planQuery.entries);
      plans = records.map((record) => ({ portfolioId: portfolioOf.get(record) ?? "", item: planOf(record) }));
    }
    return { orders, plans };
  }, [orderQuery.entries, planQuery.entries]);

  return useMemo(() => {
    const filled = groups.map((group) => withGroupExtras(group, extras));
    const filledDefault = defaultGroup ? withGroupExtras(defaultGroup, extras) : null;
    return { groups: filled, defaultGroup: filledDefault, allGroups: filledDefault ? [...filled, filledDefault] : filled };
  }, [groups, defaultGroup, extras]);
}
