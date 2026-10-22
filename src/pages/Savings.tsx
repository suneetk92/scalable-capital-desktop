import { BanknotesIcon } from "@heroicons/react/24/outline";
import { useMemo, useState } from "react";
import { planOf, type ExistingPlan } from "../savingsPlan";
import { parseSearch } from "../screener";
import { useToolQuery } from "../toolActions";
import { type Common } from "../types";
import { btn, EMPTY, PANEL_BODY, PanelFooter } from "../ui";
import { RecordTable } from "../ToolViews";
import { QueryPanel, collect, perPortfolio, Section, DetailsModal } from "./shared";
import { SavingsPlanDialog } from "./SavingsPlanDialog";
import { pluralize } from "../format";
import { TOOL } from "../commands";

export function SavingsPage({ common, onOpenSecurity }: { common: Common; onOpenSecurity: (security: { isin: string; name: string }) => void }) {
  const { actions, portfolios } = common;
  const query = useToolQuery(common.invoke, common.defs, TOOL.listSavingsPlans, actions.has(TOOL.listSavingsPlans) ? perPortfolio(portfolios) : null, common.reloadKey);
  const { records, portfolioOf } = useMemo(() => collect(query.entries), [query.entries]);
  const [config, setConfig] = useState(false);
  const [dialog, setDialog] = useState<{ existing: ExistingPlan | null; portfolioId: string } | null>(null);
  // Plans are created and changed with preview_savings_plan and submit_savings_plan, one after the other.
  const canCreate = actions.has("preview_savings_plan") && actions.has("submit_savings_plan");
  const newPlan = () => setDialog({ existing: null, portfolioId: portfolios[0]?.portfolioId ?? "" });
  return (
    <>
      <Section
        title="Savings plans"
        flush
        footer={<PanelFooter tradingEnabled={common.tradingEnabled} />}
        hint={pluralize(records.length, "plan")}
        actions={
          <>
            {actions.has(TOOL.getSavingsPlanConfig) && (
              <button className={btn.secondary} type="button" onClick={() => setConfig(true)}>
                Plan options
              </button>
            )}
            {canCreate && (
              <button className={btn.primary} type="button" onClick={newPlan}>
                New plan
              </button>
            )}
          </>
        }
      >
        <QueryPanel entries={query.entries} loading={query.loading} what="savings plans" />
        {query.entries.some((entry) => entry.outcome.ok) && (
          <RecordTable
            invoke={common.invoke}
            onOpenSecurity={onOpenSecurity}
            records={records}
            pageSize={common.pageSize}
            emptyTitle="No savings plans"
            emptyIcon={BanknotesIcon}
            emptyAction={
              canCreate && (
                <button className={btn.primary} type="button" onClick={newPlan}>
                  New plan
                </button>
              )
            }
            empty="Savings plans buy a security on a schedule. You have none yet."
            actions={
              canCreate || actions.has("remove_savings_plan")
                ? (record) => {
                    const plan = planOf(record);
                    // remove_savings_plan and the guided dialog take an ISIN, so crypto plans have no buttons here.
                    if (!plan.isin) return null;
                    const portfolioId = portfolioOf.get(record) ?? "";
                    return (
                      <>
                        {canCreate && (
                          <button className={btn.trade} type="button" onClick={() => setDialog({ existing: plan, portfolioId })}>
                            Edit
                          </button>
                        )}
                        {actions.has("remove_savings_plan") && (
                          <button
                            className={btn.sell}
                            type="button"
                            onClick={() =>
                              void actions.run(
                                "remove_savings_plan",
                                { portfolioId, isin: plan.isin },
                                { confirm: `Remove the savings plan for ${plan.name}? Future executions will stop.`, confirmLabel: "Remove plan", done: "Savings plan removed" },
                              )
                            }
                          >
                            Remove
                          </button>
                        )}
                      </>
                    );
                  }
                : undefined
            }
          />
        )}
        <p className={`${EMPTY} ${PANEL_BODY} border-t border-line`}>
          Creating, editing or removing a plan needs the Trading switch (top right) and the Full MCP access level. New and changed plans show Scalable's preview with the costs before anything is
          saved.
        </p>
      </Section>
      {dialog && (
        <SavingsPlanDialog
          existing={dialog.existing}
          portfolios={portfolios}
          portfolioId={dialog.portfolioId}
          invoke={common.invoke}
          parseSearch={parseSearch}
          tradingEnabled={common.tradingEnabled}
          onClose={() => setDialog(null)}
          onSaved={() => query.reload()}
        />
      )}
      {config && <DetailsModal title="Savings plan options" tool={TOOL.getSavingsPlanConfig} semantic={{ portfolioId: portfolios[0]?.portfolioId }} common={common} onClose={() => setConfig(false)} />}
    </>
  );
}
