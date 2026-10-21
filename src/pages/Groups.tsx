import { Field, Label } from "@headlessui/react";
import { PlusIcon, RectangleGroupIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { CheckboxField, DropdownMenu, EmptyState, ShareBar, Select, SelectAllField } from "../controls";
import { type GroupData, type SecurityGroup } from "../groups";
import { type Common, type PagePortfolio } from "../types";
import { Alert, btn, cx, EMPTY, field, LIST, LIST_ITEM, DialogFooter, SecurityCell, SignGlyph, signClass } from "../ui";
import { Modal } from "../ToolViews";
import { Section, DetailsModal } from "./shared";
import { formatNumber, formatPercent, formatSignedMoney, pluralize } from "../format";
import { TOOL } from "../commands";

type GroupFormValues = { name: string; description: string; portfolioId: string };

function GroupFormModal({
  title,
  initial,
  portfolios,
  askPortfolio,
  onSubmit,
  onClose,
}: {
  title: string;
  initial: GroupFormValues;
  portfolios: PagePortfolio[];
  askPortfolio: boolean;
  onSubmit: (values: GroupFormValues) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState(initial);
  return (
    <Modal title={title} onClose={onClose}>
      <label className={field.label}>
        Name
        <input className={field.input} autoFocus value={values.name} onChange={(event) => setValues({ ...values, name: event.currentTarget.value })} />
      </label>
      <label className={field.label}>
        Description (optional)
        <input className={field.input} value={values.description} onChange={(event) => setValues({ ...values, description: event.currentTarget.value })} />
      </label>
      {askPortfolio && portfolios.length > 1 && (
        <Field className={field.label}>
          <Label>Portfolio</Label>
          <Select
            value={values.portfolioId}
            onChange={(portfolioId) => setValues({ ...values, portfolioId })}
            options={portfolios.map((portfolio) => ({ value: portfolio.portfolioId, label: portfolio.name }))}
          />
        </Field>
      )}
      <DialogFooter>
        <button className={btn.secondary} type="button" onClick={onClose}>
          Cancel
        </button>
        <button className={btn.primary} type="button" disabled={values.name.trim() === ""} onClick={() => onSubmit({ ...values, name: values.name.trim(), description: values.description.trim() })}>
          Save
        </button>
      </DialogFooter>
    </Modal>
  );
}

function AddHoldingsModal({ group, candidates, onSubmit, onClose }: { group: SecurityGroup; candidates: { isin: string; name: string }[]; onSubmit: (isins: string[]) => void; onClose: () => void }) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const toggle = (isin: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (!next.delete(isin)) next.add(isin);
      return next;
    });
  return (
    <Modal title={`Add holdings to ${group.name}`} onClose={onClose}>
      {candidates.length === 0 ? (
        <EmptyState icon={RectangleGroupIcon} title="Every holding is in a group" text="Nothing left to add from this portfolio." />
      ) : (
        <div className="mb-3.5">
          <SelectAllField options={candidates.map((holding) => holding.isin)} selected={[...chosen]} onChange={(isins) => setChosen(new Set(isins))} />
          <div className="-ml-1.5 grid max-h-80 gap-1 overflow-y-auto pr-1 pl-1.5">
            {candidates.map((holding) => (
              <CheckboxField key={holding.isin} checked={chosen.has(holding.isin)} onChange={() => toggle(holding.isin)}>
                <SecurityCell initials={holding.name.slice(0, 2).toUpperCase()} title={holding.isin} subtitle={holding.name} />
              </CheckboxField>
            ))}
          </div>
        </div>
      )}
      <DialogFooter>
        <button className={btn.secondary} type="button" onClick={onClose}>
          Cancel
        </button>
        <button className={btn.primary} type="button" disabled={chosen.size === 0} onClick={() => onSubmit([...chosen])}>
          Add {chosen.size > 0 ? chosen.size : ""}
        </button>
      </DialogFooter>
    </Modal>
  );
}

export function GroupsPage({
  common,
  data,
  defaultGroup,
  errors,
  offered,
  formatMoney,
  onShowGroup,
}: {
  common: Common;
  data: GroupData;
  defaultGroup: SecurityGroup | null;
  errors: string[];
  offered: boolean;
  formatMoney: (value: number | null, currency?: string) => string;
  onShowGroup: (group: SecurityGroup) => void;
}) {
  const { actions, portfolios } = common;
  const [form, setForm] = useState<{ mode: "create" | "rename"; group?: SecurityGroup } | null>(null);
  const [adding, setAdding] = useState<SecurityGroup | null>(null);
  const [details, setDetails] = useState<SecurityGroup | null>(null);
  const defaultPortfolio = portfolios[0]?.portfolioId ?? "";
  const groupedTotal = [...data.groups, ...(defaultGroup ? [defaultGroup] : [])].reduce((sum, group) => sum + (group.valuation ?? 0), 0);

  if (!offered) {
    return (
      <Section title="Groups" hint="Not available">
        <p className={EMPTY}>Scalable’s connection does not offer the group tools for this sign-in. Check the MCP access level in the Scalable app, then sign out and in again.</p>
      </Section>
    );
  }

  const ungroupedFor = (portfolioId: string) => data.ungrouped.find((entry) => entry.portfolioId === portfolioId)?.holdings ?? [];

  return (
    <>
      <Section
        title="Your Scalable groups"
        hint={`${pluralize(data.groups.length, "group")}${defaultGroup ? " + default" : ""}`}
        actions={
          actions.has(TOOL.createPortfolioGroup) && (
            <button
              className={btn.primary}
              type="button"
              disabled={data.canCreate === false}
              title={data.canCreate === false ? "Scalable’s group limit is reached" : "Create a group"}
              onClick={() => setForm({ mode: "create" })}
            >
              New group
            </button>
          )
        }
      >
        {errors.map((message) => (
          <Alert key={message}>{message}</Alert>
        ))}
        {data.groups.length === 0 && errors.length === 0 && (
          <EmptyState
            icon={RectangleGroupIcon}
            title="No groups yet"
            text="Groups bundle holdings so you can follow them together. Create one, then add holdings to it."
            action={
              actions.has(TOOL.createPortfolioGroup) && (
                <button className={btn.primary} type="button" disabled={data.canCreate === false} onClick={() => setForm({ mode: "create" })}>
                  New group
                </button>
              )
            }
          />
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(21.3333rem,1fr))] gap-3">
          {[...data.groups, ...(defaultGroup ? [defaultGroup] : [])].map((group) => {
            const isDefault = group.isDefault === true;
            return (
              <article key={group.id} className={cx("flex min-w-0 flex-col gap-2.5 rounded-panel border bg-surface px-4 py-3.5", isDefault ? "border-dashed border-line-strong" : "border-line")}>
                <header className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-title text-ink-strong">{group.name}</h3>
                    {group.description && <small className="text-ink-muted">{group.description}</small>}
                  </div>
                  <strong className="font-semibold whitespace-nowrap tabular-nums text-ink-strong">{formatMoney(group.valuation, group.currency)}</strong>
                </header>
                <ul className={LIST}>
                  <li className={LIST_ITEM}>
                    <span>Since buy</span>
                    <strong className={signClass(group.sinceBuyAbsolute ?? group.sinceBuyPerformance)}>
                      <SignGlyph value={group.sinceBuyAbsolute ?? group.sinceBuyPerformance} />
                      {formatSignedMoney(group.sinceBuyAbsolute, group.currency)}
                      {group.sinceBuyPerformance !== null ? ` · ${formatPercent(group.sinceBuyPerformance * 100, 2, 2)}` : ""}
                    </strong>
                  </li>
                  <li className={LIST_ITEM}>
                    <span>Pending orders</span>
                    <strong>{group.pendingOrders ?? "—"}</strong>
                  </li>
                  {group.valuation !== null && groupedTotal > 0 && (
                    <li className="grid gap-1.5 border-b border-line py-[0.6rem] text-ink-soft">
                      <div className="flex justify-between gap-3.5">
                        <span>Share of grouped value</span>
                        <strong className="font-semibold tabular-nums text-ink-strong">{formatNumber((group.valuation / groupedTotal) * 100, 1, 1)}%</strong>
                      </div>
                      <ShareBar share={group.valuation / groupedTotal} label={`${group.name} share of grouped value`} />
                    </li>
                  )}
                  <li className={LIST_ITEM}>
                    <span>Savings plans</span>
                    <strong>{formatMoney(group.savingsPlansAmount, group.currency)}</strong>
                  </li>
                </ul>
                <div className="flex flex-wrap gap-1.5">
                  {group.holdings.length === 0 && <small className={field.hint}>No holdings in this group yet.</small>}
                  {group.holdings.map((holding) => {
                    const entry = isDefault ? data.ungrouped.find((item) => item.holdings.some((loose) => loose.isin === holding.isin)) : undefined;
                    const targets = entry ? data.groups.filter((target) => target.portfolioId === entry.portfolioId || entry.portfolioId === "") : [];
                    return (
                      <span
                        key={holding.isin}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line-strong bg-raised px-2 py-[0.2rem] text-ink-body"
                        title={`${holding.name} · ${holding.isin}`}
                      >
                        <span className="min-w-0 truncate">{holding.name}</span>
                        {!isDefault && actions.has(TOOL.removePortfolioGroupHoldings) && (
                          <button
                            type="button"
                            className="cursor-pointer leading-none text-ink-muted hover:text-down"
                            aria-label={`Remove ${holding.name} from ${group.name}`}
                            onClick={() =>
                              void actions.run(
                                TOOL.removePortfolioGroupHoldings,
                                { portfolioId: group.portfolioId, groupId: group.id, isins: [holding.isin] },
                                { done: `${holding.name} removed from ${group.name}` },
                              )
                            }
                          >
                            ×
                          </button>
                        )}
                        {isDefault && targets.length > 0 && actions.has(TOOL.addPortfolioGroupHoldings) && (
                          <DropdownMenu
                            buttonLabel={`Add ${holding.name} to a group`}
                            buttonClassName="grid size-5 shrink-0 cursor-pointer place-items-center rounded-full border border-line-strong bg-inset leading-none text-ink-soft hover:border-line-hover hover:text-ink-heading data-focus:outline data-focus:outline-accent"
                            button={<PlusIcon aria-hidden="true" className="size-3.5" />}
                            anchor="bottom start"
                            panelClassName="min-w-44"
                            items={targets.map((target) => ({
                              id: target.id,
                              label: target.name,
                              onSelect: () =>
                                void actions.run(
                                  TOOL.addPortfolioGroupHoldings,
                                  { portfolioId: target.portfolioId, groupId: target.id, isins: [holding.isin] },
                                  { done: `${holding.name} added to ${target.name}` },
                                ),
                            }))}
                          />
                        )}
                      </span>
                    );
                  })}
                </div>
                <footer className="mt-auto flex flex-wrap gap-1.5">
                  <button className={btn.trade} type="button" onClick={() => onShowGroup(group)}>
                    Show in portfolio
                  </button>
                  {!isDefault && actions.has(TOOL.getPortfolioGroup) && (
                    <button className={btn.trade} type="button" onClick={() => setDetails(group)}>
                      Details
                    </button>
                  )}
                  {!isDefault && actions.has(TOOL.addPortfolioGroupHoldings) && (
                    <button className={btn.trade} type="button" onClick={() => setAdding(group)}>
                      Add holdings
                    </button>
                  )}
                  {!isDefault && actions.has("upsert_portfolio_group") && (
                    <button className={btn.trade} type="button" onClick={() => setForm({ mode: "rename", group })}>
                      Rename
                    </button>
                  )}
                  {!isDefault && actions.has("remove_portfolio_group") && (
                    <button
                      className={btn.sell}
                      type="button"
                      onClick={() =>
                        void actions.run(
                          "remove_portfolio_group",
                          { portfolioId: group.portfolioId, groupId: group.id },
                          { confirm: `Delete the group “${group.name}”? Its holdings stay in your portfolio.`, confirmLabel: "Delete group", done: `Group “${group.name}” deleted` },
                        )
                      }
                    >
                      Delete
                    </button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      </Section>

      {form && (
        <GroupFormModal
          title={form.mode === "create" ? "New group" : "Rename group"}
          initial={{ name: form.group?.name ?? "", description: form.group?.description ?? "", portfolioId: form.group?.portfolioId ?? defaultPortfolio }}
          portfolios={portfolios}
          askPortfolio={form.mode === "create"}
          onClose={() => setForm(null)}
          onSubmit={(values) => {
            const group = form.group;
            setForm(null);
            if (form.mode === "create")
              void actions.run(TOOL.createPortfolioGroup, { portfolioId: values.portfolioId, name: values.name, description: values.description }, { done: `Group “${values.name}” created` });
            else if (group)
              void actions.run(
                "upsert_portfolio_group",
                { portfolioId: group.portfolioId, groupId: group.id, name: values.name, description: values.description },
                { done: `Group renamed to “${values.name}”` },
              );
          }}
        />
      )}
      {adding && (
        <AddHoldingsModal
          group={adding}
          candidates={ungroupedFor(adding.portfolioId)}
          onClose={() => setAdding(null)}
          onSubmit={(isins) => {
            const group = adding;
            setAdding(null);
            void actions.run(TOOL.addPortfolioGroupHoldings, { portfolioId: group.portfolioId, groupId: group.id, isins }, { done: `${isins.length} added to ${group.name}` });
          }}
        />
      )}
      {details && (
        <DetailsModal title={details.name} tool={TOOL.getPortfolioGroup} semantic={{ portfolioId: details.portfolioId, groupId: details.id }} common={common} onClose={() => setDetails(null)} />
      )}
    </>
  );
}
