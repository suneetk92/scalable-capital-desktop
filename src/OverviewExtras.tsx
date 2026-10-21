import { useEffect, useMemo, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { summarizeActivity } from "./activity";
import { useExtensionIsinLogos } from "./extensions";
import { useOvernightTransactions } from "./hooks/useOvernightTransactions";
import { useTransactionHistory } from "./hooks/useTransactionHistory";
import { FILTER_TITLE, FiltersPopover, Pagination, RadioList, SearchBox, SortHeader } from "./controls";
import { paginate } from "./paging";
import { nextSort, sortItems, type SortState } from "./sorting";
import { DetailsModal, Loading, QueryPanel, collect, perPortfolio } from "./pages/shared";
import { formatMoney, formatNumber } from "./screener";
import { formatDateTime } from "./format";
import { KeyValues, RecordTable } from "./ToolViews";
import { useToolQuery, type QueryEntry } from "./toolActions";
import type { Common } from "./types";
import { Alert, Badge, btn, Card, CardGrid, cx, DescriptionList, DescriptionRow, EMPTY, NAME_COLUMN, RECORD_TABLE, SCROLL_X, SecurityCell, SignGlyph, signClass, TD_NUM } from "./ui";
import { pickString } from "./response";
import { TOOL } from "./commands";
import { OVERNIGHT_PERIODS, OVERNIGHT_TYPES, type OvernightPeriod, type OvernightType } from "./overnight";
import { humanize } from "./tools";

function ToolCard({ title, entries, loading, children }: { title: string; entries: QueryEntry[]; loading: boolean; children?: (entry: QueryEntry) => ReactNode }) {
  return (
    <Card title={title}>
      <QueryPanel entries={entries} loading={loading} what={title.toLowerCase()} />
      {entries
        .filter((entry) => entry.outcome.ok)
        .map((entry, index) => (
          <div key={index}>{children ? children(entry) : <KeyValues value={entry.outcome.result} />}</div>
        ))}
    </Card>
  );
}

function ActivityCards({ common, currency, logosEnabled }: { common: Common; currency: string; logosEnabled: boolean }) {
  const history = useTransactionHistory(common);
  const summary = useMemo(() => summarizeActivity(history.rows, currency), [history.rows, currency]);
  const { pageSize } = common;
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>(null);
  useEffect(() => setPage(1), [pageSize]);
  const sortedSecurities = useMemo(
    () => sortItems(summary.securities, sort, (security, key) => (key === "name" ? security.name || security.isin : security[key as keyof typeof security])),
    [summary.securities, sort],
  );
  const securities = paginate(sortedSecurities, page, pageSize);
  const securityLogos = useExtensionIsinLogos({ invoke: common.invoke, isins: securities.rows.map((security) => security.isin), enabled: logosEnabled });
  if (!common.actions.has(TOOL.listPortfolioTransactions)) return null;
  const sortSecurities = (column: string) => {
    setSort((current) => nextSort(current, column));
    setPage(1);
  };
  const money = (value: number) => formatMoney(value, summary.currency);
  const signed = (value: number) => `${value > 0 ? "+" : ""}${money(value)}`;
  const outflow = (value: number) => money(value === 0 ? 0 : -value);
  const hint =
    summary.counted > 0
      ? summary.counted === summary.total
        ? `all ${formatNumber(summary.total, 0)} transactions`
        : `${formatNumber(summary.counted, 0)} of ${formatNumber(summary.total, 0)} transactions`
      : undefined;
  const waiting = history.loading && history.rows.length === 0;
  const empty = summary.counted === 0;
  const note = waiting ? <Loading show what="transactions" /> : <p className={EMPTY}>No completed transactions were loaded.</p>;
  const progress = history.progress;
  const status = history.loading
    ? progress && progress.loaded > 0
      ? `Loading transactions: ${formatNumber(progress.loaded, 0)}${progress.total ? ` of ${formatNumber(progress.total, 0)}` : ""}…`
      : "Loading transactions…"
    : history.syncedAt !== null
      ? `Stored on this computer, updated ${formatDateTime(history.syncedAt)}.`
      : "";
  return (
    <>
      {history.error && <Alert>{history.error}</Alert>}
      {(status !== "" || history.rows.length > 0) && (
        <p className={cx(EMPTY, "mb-3.5 flex flex-wrap items-center gap-x-3 gap-y-1")}>
          <span>{status}</span>
          <button className={btn.link} type="button" disabled={history.loading} onClick={history.reloadAll}>
            Reload all
          </button>
        </p>
      )}
      {summary.ignored.length > 0 && (
        <p className={cx(EMPTY, "mb-3.5")}>
          Not in these totals ({formatNumber(summary.total - summary.counted, 0)} of {formatNumber(summary.total, 0)} transactions):{" "}
          {summary.ignored.map((entry) => `${entry.label} ${formatNumber(entry.count, 0)}`).join(", ")}.
        </p>
      )}
      <CardGrid label="Activity">
        <Card title="Trading" hint={hint}>
          {empty ? (
            note
          ) : (
            <DescriptionList>
              <DescriptionRow label="Bought">{money(summary.bought)}</DescriptionRow>
              <DescriptionRow label="Sold">{outflow(summary.sold)}</DescriptionRow>
              <DescriptionRow label="Net invested" tone={summary.netInvested > 0 ? "up" : summary.netInvested < 0 ? "down" : undefined}>
                {signed(summary.netInvested)}
              </DescriptionRow>
              <DescriptionRow label="Fees">{outflow(summary.fees)}</DescriptionRow>
              <DescriptionRow label="Taxes">{money(summary.taxes)}</DescriptionRow>
            </DescriptionList>
          )}
        </Card>
        <Card title="Income and cash" hint={hint}>
          {empty ? (
            note
          ) : (
            <DescriptionList>
              <DescriptionRow label="Dividends">{money(summary.dividends)}</DescriptionRow>
              <DescriptionRow label="Interest">{money(summary.interest)}</DescriptionRow>
              <DescriptionRow label="Deposits">{money(summary.deposits)}</DescriptionRow>
              <DescriptionRow label="Withdrawals">{outflow(summary.withdrawals)}</DescriptionRow>
              <DescriptionRow label="Net deposits" tone={summary.netDeposits > 0 ? "up" : summary.netDeposits < 0 ? "down" : undefined}>
                {signed(summary.netDeposits)}
              </DescriptionRow>
            </DescriptionList>
          )}
        </Card>
        {summary.securities.length > 0 && (
          <Card title="By security" hint={hint} wide>
            <div className={SCROLL_X}>
              <table className={RECORD_TABLE}>
                <thead>
                  <tr>
                    <SortHeader label="ISIN / name" column="name" sort={sort} onSort={sortSecurities} className={NAME_COLUMN} />
                    <SortHeader numeric label="Bought" column="boughtAmount" sort={sort} onSort={sortSecurities} />
                    <SortHeader numeric label="Sold" column="soldAmount" sort={sort} onSort={sortSecurities} />
                    <SortHeader numeric label="Avg buy price" column="averageBuyPrice" sort={sort} onSort={sortSecurities} />
                    <SortHeader numeric label="Realised (avg. cost)" column="realised" sort={sort} onSort={sortSecurities} />
                    <SortHeader numeric label="Fees" column="fees" sort={sort} onSort={sortSecurities} />
                    <SortHeader numeric label="Dividends" column="dividends" sort={sort} onSort={sortSecurities} />
                  </tr>
                </thead>
                <tbody>
                  {securities.rows.map((security) => (
                    <tr key={security.isin}>
                      <td>
                        <SecurityCell
                          initials={(security.name || security.isin).slice(0, 2).toUpperCase()}
                          logo={securityLogos.get(security.isin.toUpperCase())}
                          title={security.isin || security.name}
                          subtitle={security.isin && security.name ? security.name : undefined}
                        />
                      </td>
                      <td className={TD_NUM}>{money(security.boughtAmount)}</td>
                      <td className={TD_NUM}>{money(security.soldAmount)}</td>
                      <td className={TD_NUM}>{security.averageBuyPrice === null ? "—" : money(security.averageBuyPrice)}</td>
                      <td className={cx(TD_NUM, signClass(security.realised))}>
                        <SignGlyph value={security.realised} />
                        {security.realised === null ? "—" : signed(security.realised)}
                      </td>
                      <td className={TD_NUM}>{money(security.fees)}</td>
                      <td className={TD_NUM}>{money(security.dividends)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="-mx-[1.2rem] -mb-4 mt-3">
              <Pagination page={securities.page} pageCount={securities.pageCount} total={summary.securities.length} pageSize={securities.size} onPage={setPage} />
            </div>
          </Card>
        )}
      </CardGrid>
    </>
  );
}

function OvernightTransactionsCard({ common, currency }: { common: Common; currency: string }) {
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [type, setType] = useState<OvernightType>("all");
  const [period, setPeriod] = useState<OvernightPeriod>("all");
  const [openError, setOpenError] = useState<string | null>(null);
  const history = useOvernightTransactions(common, { searchTerm, type, period });
  useEffect(() => {
    const timeout = window.setTimeout(() => setSearchTerm(search.trim()), 400);
    return () => window.clearTimeout(timeout);
  }, [search]);
  if (!common.actions.has("list_overnight_transactions")) return null;
  const activeFilters = Number(type !== "all") + Number(period !== "all");
  const hint = `${formatNumber(history.rows.length, 0)} of ${formatNumber(history.total, 0)} transactions`;
  const clearFilters = () => {
    setType("all");
    setPeriod("all");
  };
  return (
    <Card title="Overnight transactions" hint={hint} wide>
      {history.account && <p className="mb-3 text-ink-muted">{history.account.displayName}</p>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchBox className="min-w-48 flex-1" value={search} onChange={setSearch} placeholder="Search transactions" label="Search overnight transactions" />
        <FiltersPopover count={activeFilters} onClear={clearFilters}>
          <div className="grid gap-3">
            <div>
              <p className={FILTER_TITLE}>Type</p>
              <RadioList label="Transaction type" value={type} options={OVERNIGHT_TYPES.map(({ value, label }) => [value, label] as [OvernightType, string])} onChange={setType} />
            </div>
            <div>
              <p className={FILTER_TITLE}>Period</p>
              <RadioList label="Transaction period" value={period} options={OVERNIGHT_PERIODS.map(({ value, label }) => [value, label] as [OvernightPeriod, string])} onChange={setPeriod} />
            </div>
          </div>
        </FiltersPopover>
      </div>
      {history.error && <Alert>{history.error}</Alert>}
      {openError && <Alert onDismiss={() => setOpenError(null)}>{openError}</Alert>}
      {history.loading && history.rows.length === 0 ? (
        <p className={EMPTY}>Loading overnight transactions…</p>
      ) : history.rows.length === 0 ? (
        <p className={EMPTY}>No overnight transactions were found.</p>
      ) : (
        <div className={SCROLL_X}>
          <table className={RECORD_TABLE}>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Type</th>
                <th scope="col">Description</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">
                  Amount
                </th>
                <th scope="col">Documents</th>
              </tr>
            </thead>
            <tbody>
              {history.rows.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap">{formatDateTime(row.when)}</td>
                  <td>
                    <Badge>{row.kind ? humanize(row.kind) : "Unknown"}</Badge>
                  </td>
                  <td>{row.description || "—"}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {row.status ? <Badge>{humanize(row.status)}</Badge> : "—"}
                      {row.cancellation && <span className="text-ink-muted">Cancellation</span>}
                    </div>
                  </td>
                  <td className={cx(TD_NUM, signClass(row.amount))}>
                    <SignGlyph value={row.amount} />
                    {row.amount === null ? "—" : `${row.amount > 0 ? "+" : ""}${formatMoney(row.amount, row.currency ?? currency)}`}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-x-2">
                      {row.documents.map((document, index) => (
                        <button
                          key={document.id ?? document.url ?? index}
                          className={btn.link}
                          type="button"
                          onClick={() => void openUrl(document.url).catch((error: unknown) => setOpenError(String(error)))}
                        >
                          {document.label || "Open document"}
                        </button>
                      ))}
                      {row.documents.length === 0 && "—"}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {history.nextCursor && (
        <div className="mt-3 flex justify-center">
          <button className={btn.secondary} type="button" disabled={history.loading} onClick={() => void history.loadMore()}>
            {history.loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </Card>
  );
}

export function OverviewExtras({ common, currency, logosEnabled }: { common: Common; currency: string; logosEnabled: boolean }) {
  const { invoke, defs, portfolios, reloadKey } = common;
  const has = (name: string) => defs.some((tool) => tool.name === name);
  const profile = useToolQuery(invoke, defs, TOOL.getAccountProfile, has(TOOL.getAccountProfile) ? [{}] : null, reloadKey);
  const overnight = useToolQuery(invoke, defs, "get_overnight_summary", has("get_overnight_summary") ? perPortfolio(portfolios) : null, reloadKey);
  const fixed = useToolQuery(invoke, defs, "list_fixed_term_accounts", has("list_fixed_term_accounts") ? [{}] : null, reloadKey);
  const [detail, setDetail] = useState<string | null>(null);
  const accounts = collect(fixed.entries).records;
  return (
    <>
      <ActivityCards common={common} currency={currency} logosEnabled={logosEnabled} />
      <CardGrid label="Account details">
        {has(TOOL.getAccountProfile) && <ToolCard title="Account profile" entries={profile.entries} loading={profile.loading} />}
        {has("get_overnight_summary") && <ToolCard title="Overnight summary" entries={overnight.entries} loading={overnight.loading} />}
        <OvernightTransactionsCard common={common} currency={currency} />
        {has("list_fixed_term_accounts") && (
          <Card title="Fixed-term accounts" wide>
            <QueryPanel entries={fixed.entries} loading={fixed.loading} what="fixed-term accounts" />
            {fixed.entries.some((entry) => entry.outcome.ok) && (
              <RecordTable
                records={accounts}
                pageSize={common.pageSize}
                empty="You have no fixed-term accounts."
                actions={
                  has("get_fixed_term_account")
                    ? (record) => {
                        const id = pickString(record, ["fixedTermAccountId", "accountId", "id"]);
                        return (
                          <button className={btn.trade} type="button" disabled={!id} onClick={() => id && setDetail(id)}>
                            Details
                          </button>
                        );
                      }
                    : undefined
                }
              />
            )}
          </Card>
        )}
      </CardGrid>
      {detail && <DetailsModal title="Fixed-term account" tool="get_fixed_term_account" semantic={{ fixedTermAccountId: detail }} common={common} onClose={() => setDetail(null)} />}
    </>
  );
}
