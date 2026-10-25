import { BanknotesIcon } from "@heroicons/react/24/outline";
import { useDeferredValue, useMemo, useState, type Ref } from "react";
import { isPlanFiltering, matchesPlan, NO_PLAN_FILTER, planOf, type PlanDialogState, type PlanFilter } from "../savingsPlan";
import { FILTER_TITLE, FiltersPopover, RadioList, SearchBox } from "../controls";
import { parseSearch } from "../screener";
import { useToolQuery } from "../toolActions";
import { type Common } from "../types";
import { btn, EMPTY, PANEL_BODY, PanelFooter } from "../ui";
import { RecordTable } from "../ToolViews";
import { QueryPanel, collect, perPortfolio, Section, DetailsModal } from "./shared";
import { SavingsPlanDialog } from "./SavingsPlanDialog";
import { pluralize } from "../format";
import { TOOL } from "../commands";

const frequencyLabel = (value: string) => {
  const text = value.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export function SavingsPage({
  common,
  searchInput,
  dialog,
  onDialog,
  onOpenSecurity,
}: {
  common: Common;
  searchInput?: Ref<HTMLInputElement>;
  dialog: PlanDialogState | null;
  onDialog: (dialog: PlanDialogState | null) => void;
  onOpenSecurity: (security: { isin: string; name: string }) => void;
}) {
  const { actions, portfolios } = common;
  const query = useToolQuery(common.invoke, common.defs, TOOL.listSavingsPlans, actions.has(TOOL.listSavingsPlans) ? perPortfolio(portfolios) : null, common.reloadKey);
  const { records, portfolioOf } = useMemo(() => collect(query.entries), [query.entries]);
  const [config, setConfig] = useState(false);
  const [filter, setFilter] = useState<PlanFilter>(NO_PLAN_FILTER);
  const shownFilter = useDeferredValue(filter);
  const filtering = isPlanFiltering(shownFilter);
  const visible = useMemo(() => (filtering ? records.filter((record) => matchesPlan(record, shownFilter)) : records), [filtering, records, shownFilter]);
  const frequencies = useMemo(() => [...new Set(records.map((record) => planOf(record).frequency).filter((value) => value !== ""))].sort(), [records]);
  const change = (next: Partial<PlanFilter>) => setFilter((current) => ({ ...current, ...next }));
  // Plans are created and changed with preview_savings_plan and submit_savings_plan, one after the other.
  const canCreate = actions.has("preview_savings_plan") && actions.has("submit_savings_plan");
  return (
    <>
      <Section
        title="Savings plans"
        flush
        footer={<PanelFooter tradingEnabled={common.tradingEnabled} manageEnabled={common.manageEnabled} />}
        hint={filtering ? `${pluralize(visible.length, "plan")} match${records.length !== visible.length ? ` (of ${records.length})` : ""}` : pluralize(records.length, "plan")}
        toolbar={
          <div className="flex min-h-[3.6667rem] items-center justify-end gap-3.5 border-b border-line px-4 max-[900px]:flex-col max-[900px]:items-start">
            <div className="flex items-center gap-2 max-[900px]:w-full max-[900px]:pb-2.5" role="search" aria-label="Filter savings plans">
              <SearchBox
                inputRef={searchInput}
                value={filter.text}
                onChange={(text) => change({ text })}
                placeholder="Search symbol or name"
                label="Search savings plans by symbol or name"
                shortcut={searchInput !== undefined}
              />
              <FiltersPopover count={filter.frequency !== "" ? 1 : 0} onClear={() => change({ frequency: "" })}>
                <div className={FILTER_TITLE}>Frequency</div>
                <RadioList<string>
                  label="Frequency"
                  value={filter.frequency}
                  onChange={(frequency) => change({ frequency })}
                  options={[["", "All"], ...frequencies.map((value): [string, string] => [value, frequencyLabel(value)])]}
                />
              </FiltersPopover>
            </div>
          </div>
        }
        actions={
          <>
            {actions.has(TOOL.getSavingsPlanConfig) && (
              <button className={btn.secondary} type="button" onClick={() => setConfig(true)}>
                Plan options
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
            records={visible}
            pageSize={common.pageSize}
            emptyTitle={filtering && records.length > 0 ? "No matching plans" : "No savings plans"}
            emptyIcon={BanknotesIcon}
            empty={filtering && records.length > 0 ? "Try another search or clear the filters." : "Savings plans buy a security on a schedule. You have none yet. Use New plan at the top to add one."}
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
                          <button className={btn.trade} type="button" onClick={() => onDialog({ existing: plan, portfolioId })}>
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
          onClose={() => onDialog(null)}
          onSaved={() => query.reload()}
        />
      )}
      {config && <DetailsModal title="Savings plan options" tool={TOOL.getSavingsPlanConfig} semantic={{ portfolioId: portfolios[0]?.portfolioId }} common={common} onClose={() => setConfig(false)} />}
    </>
  );
}
