import { type ReactNode } from "react";
import { useLastUpdated } from "../app/AppContext";
import { formatDate } from "../format";
import { SearchBox, SkeletonRows } from "../controls";
import { useToolQuery, type QueryEntry } from "../toolActions";
import { type Common, type PagePortfolio } from "../types";
import { Alert, PANEL, PANEL_BODY, PanelHeader } from "../ui";
import { JsonView, KeyValues, Modal, RecordTable } from "../ToolViews";
import { findRecords, type Rec } from "../response";

export function Loading({ show, what }: { show: boolean; what: string }) {
  return show ? <SkeletonRows rows={3} columns={3} label={`Loading ${what}…`} /> : null;
}

function Errors({ entries }: { entries: QueryEntry[] }) {
  const messages = [...new Set(entries.filter((entry) => !entry.outcome.ok).map((entry) => entry.outcome.error ?? "The tool call failed."))];
  return (
    <>
      {messages.map((message) => (
        <Alert key={message}>{message}</Alert>
      ))}
    </>
  );
}

export function QueryPanel({ entries, loading, what, className = PANEL_BODY }: { entries: QueryEntry[]; loading: boolean; what: string; className?: string }) {
  if (!(loading && entries.length === 0) && !entries.some((entry) => !entry.outcome.ok)) return null;
  return (
    <div className={className}>
      <Loading show={loading && entries.length === 0} what={what} />
      <Errors entries={entries} />
    </div>
  );
}

/** All records of every successful entry, remembering which portfolio each one came from. */
export function collect(entries: QueryEntry[]) {
  const records: Rec[] = [];
  const portfolioOf = new Map<Rec, string>();
  for (const entry of entries) {
    if (!entry.outcome.ok) continue;
    for (const record of findRecords(entry.outcome.result)) {
      records.push(record);
      portfolioOf.set(record, String(entry.semantic.portfolioId ?? ""));
    }
  }
  return { records, portfolioOf };
}

export function perPortfolio(portfolios: PagePortfolio[], extra: Rec = {}): Rec[] {
  return portfolios.length > 0 ? portfolios.map((portfolio) => ({ portfolioId: portfolio.portfolioId, ...extra })) : [{ ...extra }];
}

/** "Updated 23:32" for the title bar of a table panel; the time of the last account refresh. */
export function UpdatedAt() {
  const lastUpdated = useLastUpdated();
  return lastUpdated ? <span>Updated {formatDate(lastUpdated, { hour: "2-digit", minute: "2-digit" })}</span> : null;
}

/** The search bar for a table panel; pass it as the `toolbar` of a Section. */
export function SearchToolbar({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  return (
    <div className="flex min-h-[3.6667rem] items-center justify-end gap-3.5 border-b border-line px-4" role="search" aria-label={label}>
      <SearchBox value={value} onChange={onChange} placeholder={placeholder} label={label} />
    </div>
  );
}

/** A panel with a title bar like the Portfolio table's. `flush` is for a table, which sits against the panel edges; `footer` ends the panel with a PanelFooter. */
export function Section({
  title,
  hint,
  actions,
  toolbar,
  flush = false,
  footer,
  children,
}: {
  title: string;
  hint?: ReactNode;
  actions?: ReactNode;
  /** A bar above the title, like the search and filters of the Portfolio table. */
  toolbar?: ReactNode;
  flush?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`${PANEL} mb-4`} aria-label={title}>
      {toolbar}
      <PanelHeader title={title}>
        {hint}
        <UpdatedAt />
        {actions}
      </PanelHeader>
      <div className={flush ? undefined : PANEL_BODY}>{children}</div>
      {footer}
    </section>
  );
}

/* ---------- Details modal for any single-record tool ---------- */

export function DetailsModal({ title, tool, semantic, common, onClose }: { title: string; tool: string; semantic: Rec; common: Common; onClose: () => void }) {
  const query = useToolQuery(common.invoke, common.defs, tool, [semantic], common.reloadKey);
  const outcome = query.entries[0]?.outcome;
  const records = outcome?.ok ? findRecords(outcome.result) : [];
  return (
    <Modal title={title} onClose={onClose} wide>
      <Loading show={query.loading && !outcome} what={title.toLowerCase()} />
      <Errors entries={query.entries} />
      {outcome?.ok && (
        <>
          <KeyValues value={outcome.result} limit={24} />
          {records.length > 0 && <RecordTable records={records} empty="" />}
          <JsonView value={outcome.result} />
        </>
      )}
    </Modal>
  );
}
