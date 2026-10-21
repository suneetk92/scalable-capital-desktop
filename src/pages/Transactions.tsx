import { Tab, TabGroup, TabList } from "@headlessui/react";
import { ArrowTrendingDownIcon, ArrowTrendingUpIcon, ArrowsRightLeftIcon, BanknotesIcon, ClockIcon, ListBulletIcon, MagnifyingGlassIcon, TableCellsIcon } from "@heroicons/react/24/outline";
import { useCallback, useDeferredValue, useEffect, useMemo, useState, type Ref } from "react";
import { ColumnHead, inOrder, resizedTable } from "../ColumnHead";
import { EmptyState, FILTER_TITLE, FiltersPopover, Feed, Pagination, RadioList, SearchBox, SortHeader, type FeedItem } from "../controls";
import { useTableLayout } from "../hooks/useTableLayout";
import { useChunkedMap } from "../hooks/useChunkedMap";
import { useExtensionIsinLogos } from "../extensions";
import { useTransactionHistory } from "../hooks/useTransactionHistory";
import { nextSort, sortItems, type SortState } from "../sorting";
import { dedupeRows, distinctValues, isFiltering, isOpenOrder, matchesFilter, newestFirst, NO_FILTER, type TransactionFilter, type TransactionRow } from "../transactions";
import { type Common } from "../types";
import { Alert, Badge, btn, cx, NAME_COLUMN, PANEL, PANEL_BODY, PanelFooter, PanelHeader, RECORD_TABLE, SCROLL_X, SecurityCell, SignGlyph, signClass, TABS, tabClass, TD_NUM } from "../ui";
import { csvCell } from "../screener";
import { formatCell, humanize } from "../tools";
import { pick, pickString, type Rec } from "../response";
import type { FoundSecurity } from "./Discover";
import { Loading, DetailsModal } from "./shared";
import { pluralize } from "../format";
import { TOOL } from "../commands";

type TransactionFields = {
  kind: string;
  status?: string;
  isin?: string;
  name?: string;
  when: string;
  quantity?: string;
  limit?: string;
  amount: number | null;
};

/** Reads the fields shared by the timeline and the table from one transaction record; unknown formats still get what exists. */
function transactionFields(record: Rec): TransactionFields {
  const security = pick(record, ["security"]);
  const cash = pick(record, ["cash"]);
  const kind =
    pickString(security, ["side"]) ??
    pickString(record, ["side", "transactionType", "type", "direction"]) ??
    pickString(cash, ["type", "transactionType"]) ??
    pickString(record, ["category", "kind"]) ??
    "";
  const amountValue = pick(record, ["amount", "totalAmount", "netAmount", "value", "price"]) ?? pick(cash, ["amount"]) ?? pick(security, ["amount"]);
  const parsedAmount = typeof amountValue === "string" && amountValue.trim() !== "" ? Number(amountValue) : amountValue;
  return {
    kind,
    status: pickString(record, ["status", "state", "orderStatus"]),
    isin: pickString(security, ["isin"]) ?? pickString(record, ["isin"]) ?? pickString(cash, ["relatedIsin", "isin"]),
    name: pickString(security, ["name", "securityName"]) ?? pickString(record, ["name", "securityName", "description", "title"]),
    when: formatCell(pick(record, ["lastEventAt", "date", "timestamp", "timestampUtc", "createdAt", "executedAt", "valueDate", "time"])),
    quantity: pickString(security, ["quantity"]),
    limit: pickString(security, ["limitPrice"]),
    amount: typeof parsedAmount === "number" && Number.isFinite(parsedAmount) ? parsedAmount : null,
  };
}

function kindFlags(kind: string) {
  const lower = kind.toLowerCase();
  return {
    isBuy: /buy|purchase/.test(lower),
    isSell: /sell|sale/.test(lower),
    isCash: /deposit|withdraw|dividend|interest|fee|tax|transfer|cash/.test(lower),
  };
}

/** Turns one transaction record into a timeline entry. */
function transactionEntry(fields: TransactionFields, name: string | undefined, onOpen: (() => void) | undefined, index: number, id: string | undefined): Omit<FeedItem, "actions"> {
  const { isBuy, isSell, isCash } = kindFlags(fields.kind);
  const detailText = [fields.quantity ? `${fields.quantity} shares` : "", fields.limit ? `limit ${fields.limit}` : ""].filter(Boolean).join(", ");
  const label = name ?? fields.isin ?? "Transaction";
  return {
    id: String(id ?? index),
    icon: isBuy ? ArrowTrendingUpIcon : isSell ? ArrowTrendingDownIcon : isCash ? BanknotesIcon : ArrowsRightLeftIcon,
    tone: isBuy ? "up" : isSell ? "down" : "neutral",
    title: (
      <>
        {fields.kind && <span className="mr-1.5 text-ink-muted">{humanize(fields.kind)}</span>}
        {onOpen ? (
          <button className={`${btn.link} text-left hover:underline`} type="button" onClick={onOpen} title="Open security details">
            {label}
          </button>
        ) : (
          label
        )}
      </>
    ),
    meta: [fields.isin ?? "", fields.status ? humanize(fields.status) : "", detailText, fields.when !== "—" ? fields.when : ""].filter(Boolean).join(" · ") || undefined,
    amount: fields.amount !== null ? formatCell(fields.amount) : undefined,
    amountTone: fields.amount !== null && fields.amount !== 0 ? (fields.amount > 0 ? "up" : "down") : undefined,
  };
}

const TAB_FOCUS = "outline-none data-focus:outline-2 data-focus:outline-accent";

const WHEN_FIELDS = ["lastEventAt", "date", "timestamp", "timestampUtc", "createdAt", "executedAt", "valueDate", "time"];

/** What a table column is sorted by. Dates are compared as times, not as the text shown. */
function sortValue(row: { record: Rec; fields: TransactionFields }, key: string, name: string | undefined, symbol: string | undefined): unknown {
  const { fields } = row;
  switch (key) {
    case "when": {
      const raw = pick(row.record, WHEN_FIELDS);
      const time = typeof raw === "string" || typeof raw === "number" ? new Date(raw).getTime() : Number.NaN;
      return Number.isNaN(time) ? fields.when : time;
    }
    case "kind":
      return fields.kind;
    case "name":
      return symbol ?? name ?? fields.isin;
    case "status":
      return fields.status;
    case "quantity":
      return fields.quantity ? Number(fields.quantity) : null;
    case "limit":
      return fields.limit ? Number(fields.limit) : null;
    default:
      return fields.amount;
  }
}

const withFields = (row: TransactionRow) => ({ ...row, fields: transactionFields(row.record) });

const optionsOf = (values: (string | undefined)[], current: string, all: string): [string, string][] => [
  ["", all],
  ...distinctValues([...values, current]).map((value): [string, string] => [value, humanize(value)]),
];

const COLUMNS = ["when", "kind", "name", "status", "quantity", "limit", "amount", "actions"];
const HEADS: Record<string, { label: string; numeric?: boolean; className?: string }> = {
  when: { label: "Date" },
  kind: { label: "Type" },
  name: { label: "Symbol / Name", className: NAME_COLUMN },
  status: { label: "Status" },
  quantity: { label: "Quantity", numeric: true },
  limit: { label: "Limit price", numeric: true },
  amount: { label: "Amount", numeric: true },
};

export function TransactionsPage({
  common,
  logosEnabled,
  knownNames,
  knownSymbols,
  searchInput,
  onOpenSecurity,
}: {
  common: Common;
  logosEnabled: boolean;
  knownNames: Map<string, string>;
  knownSymbols: Map<string, string>;
  searchInput?: Ref<HTMLInputElement>;
  onOpenSecurity: (security: FoundSecurity) => void;
}) {
  const { actions, pageSize } = common;
  // Every transaction comes from the history stored on this computer (the same one the Overview uses), which is
  // brought up to date in the background, so the pages cover all of it instead of only what was fetched so far.
  const history = useTransactionHistory(common);
  // A long history is read into rows in slices, so the page stays responsive while it is prepared.
  const prepared = useMemo(() => newestFirst(dedupeRows(history.rows)), [history.rows]);
  const { items: rows, busy: preparing } = useChunkedMap(prepared, withFields);

  // Names come from the transaction itself, or from holdings and watchlist. No extra lookups: there can be many transactions.
  const nameOf = useCallback((fields: TransactionFields) => fields.name ?? (fields.isin ? knownNames.get(fields.isin) : undefined), [knownNames]);
  const symbolOf = useCallback((fields: TransactionFields) => (fields.isin ? knownSymbols.get(fields.isin) : undefined), [knownSymbols]);
  const openSecurity = (fields: TransactionFields) => {
    if (fields.isin) onOpenSecurity({ isin: fields.isin, name: nameOf(fields) ?? fields.isin, type: "", record: {} });
  };

  const [detail, setDetail] = useState<{ portfolioId: string; id: string } | null>(null);
  const [mode, setMode] = useState<"feed" | "table">("table");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [pageSize]);

  const [filter, setFilter] = useState<TransactionFilter>(NO_FILTER);
  // Typing in the search and changing the sort are urgent; filtering and sorting the whole history follows when the browser is free.
  const shownFilter = useDeferredValue(filter);
  const filtering = isFiltering(shownFilter);
  const changeFilter = (change: Partial<TransactionFilter>) => {
    setFilter((current) => ({ ...current, ...change }));
    setPage(1);
  };
  const visible = useMemo(() => (filtering ? rows.filter((row) => matchesFilter({ ...row.fields, name: nameOf(row.fields) }, shownFilter)) : rows), [rows, shownFilter, filtering, nameOf]);
  const activeFilters = (filter.kind !== "" ? 1 : 0) + (filter.status !== "" ? 1 : 0);
  const kindOptions = useMemo(
    () =>
      optionsOf(
        rows.map((row) => row.fields.kind),
        filter.kind,
        "All types",
      ),
    [rows, filter.kind],
  );
  const statusOptions = useMemo(
    () =>
      optionsOf(
        rows.map((row) => row.fields.status),
        filter.status,
        "All statuses",
      ),
    [rows, filter.status],
  );

  const rowActions = (record: Rec, portfolioId: string) => {
    const id = pickString(record, ["transactionId", "id", "orderId"]);
    return (
      <>
        {actions.has(TOOL.getTransactionDetails) && (
          <button className={btn.trade} type="button" disabled={!id} onClick={() => id && setDetail({ portfolioId, id })}>
            Details
          </button>
        )}
        {actions.has(TOOL.cancelOrder) && isOpenOrder(record) && (
          <button
            className={btn.sell}
            type="button"
            onClick={() =>
              void actions.run(
                TOOL.cancelOrder,
                { portfolioId, orderId: pickString(record, ["orderId", "id"]), transactionId: id },
                { confirm: "Cancel this open order?", confirmLabel: "Cancel order", done: "Order cancelled" },
              )
            }
          >
            Cancel
          </button>
        )}
      </>
    );
  };

  // Sorting covers every page and only applies to the table; the timeline stays newest first.
  const [sort, setSort] = useState<SortState>(null);
  const { order, layout } = useTableLayout("transactions", COLUMNS);
  const resized = resizedTable(layout.widths);
  const sortColumn = (column: string) => {
    setSort((current) => nextSort(current, column));
    setPage(1);
  };
  const shownSort = useDeferredValue(sort);
  const ordered = useMemo(
    () => (mode === "table" ? sortItems(visible, shownSort, (row, key) => sortValue(row, key, nameOf(row.fields), symbolOf(row.fields))) : visible),
    [visible, shownSort, mode, nameOf, symbolOf],
  );

  const rowsPerPage = pageSize > 0 ? pageSize : Math.max(ordered.length, 1);
  const pageCount = Math.max(1, Math.ceil(ordered.length / rowsPerPage));
  const currentPage = Math.min(page, pageCount);
  const pageRows = ordered.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  // Company logos, for the rows of the shown page only.
  const logos = useExtensionIsinLogos({ invoke: common.invoke, isins: pageRows.map((row) => row.fields.isin ?? ""), enabled: logosEnabled });

  const items: FeedItem[] = pageRows.map((row, index) => ({
    ...transactionEntry(row.fields, nameOf(row.fields), row.fields.isin ? () => openSecurity(row.fields) : undefined, index, pickString(row.record, ["transactionId", "id", "orderId"])),
    id: `${currentPage}-${index}-${pickString(row.record, ["transactionId", "id", "orderId"]) ?? index}`,
    actions: rowActions(row.record, row.portfolioId),
  }));

  const copyCsv = async () => {
    const lines = [
      ["Date", "Type", "ISIN", "Name", "Status", "Quantity", "Limit price", "Amount"],
      ...visible.map((row) => {
        const { fields } = row;
        return [
          fields.when,
          fields.kind ? humanize(fields.kind) : "",
          fields.isin ?? "",
          nameOf(fields) ?? "",
          fields.status ? humanize(fields.status) : "",
          fields.quantity ?? "",
          fields.limit ?? "",
          fields.amount,
        ];
      }),
    ].map((line) => line.map((cell) => csvCell(cell === "" ? null : cell)).join(","));
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      actions.notify({ kind: "ok", text: `${pluralize(visible.length, "transaction")} copied as CSV` });
    } catch {
      actions.notify({ kind: "error", text: "Could not copy to the clipboard." });
    }
  };

  const loaded = rows.length > 0 || (!history.loading && !preparing && history.error === null);
  const { progress } = history;
  return (
    <>
      <section className={cx(PANEL, "mb-4")} aria-label="Transactions">
        <div className="flex min-h-[3.6667rem] items-center justify-between gap-3.5 border-b border-line px-4 max-[900px]:flex-col max-[900px]:items-start max-[900px]:pt-0">
          <TabGroup selectedIndex={mode === "table" ? 0 : 1} onChange={(index) => setMode(index === 1 ? "feed" : "table")} className="self-stretch">
            <TabList className={`${TABS} h-full max-[900px]:h-[3.2667rem]`} aria-label="Transactions view">
              <Tab className={({ selected }) => cx(tabClass(selected), TAB_FOCUS)}>
                <TableCellsIcon /> Table
              </Tab>
              <Tab className={({ selected }) => cx(tabClass(selected), TAB_FOCUS)}>
                <ListBulletIcon /> Timeline
              </Tab>
            </TabList>
          </TabGroup>
          <div className="flex items-center gap-2 max-[900px]:w-full max-[900px]:pb-2.5" role="search" aria-label="Filter transactions">
            <SearchBox
              inputRef={searchInput}
              value={filter.text}
              onChange={(text) => changeFilter({ text })}
              placeholder="Search ISIN or name"
              label="Search transactions by ISIN or name"
              shortcut={searchInput !== undefined}
            />
            <FiltersPopover count={activeFilters} onClear={() => changeFilter({ kind: "", status: "" })}>
              <div className={FILTER_TITLE}>Type</div>
              <RadioList label="Type" value={filter.kind} onChange={(kind) => changeFilter({ kind })} options={kindOptions} />
              <div className={FILTER_TITLE}>Status</div>
              <RadioList label="Status" value={filter.status} onChange={(status) => changeFilter({ status })} options={statusOptions} />
            </FiltersPopover>
            <button className={btn.secondary} type="button" onClick={() => void copyCsv()} disabled={visible.length === 0} title="Copy the rows shown as CSV">
              Copy CSV
            </button>
          </div>
        </div>
        <PanelHeader title="Transactions">
          {(loaded || history.loading || preparing) && (
            <span aria-live="polite">
              {history.loading || preparing ? `Loading${progress && progress.loaded > 0 ? ` ${progress.loaded}${progress.total ? ` of ${progress.total}` : ""}` : ""}… ` : ""}
              {pluralize(visible.length, "transaction")}
              {filtering ? " match" : ""}
              {filtering && rows.length !== visible.length ? ` (of ${rows.length})` : ""}
            </span>
          )}
        </PanelHeader>
        {(((history.loading || preparing) && rows.length === 0) || history.error) && (
          <div className={PANEL_BODY}>
            <Loading show={(history.loading || preparing) && rows.length === 0} what="transactions" />
            {history.error && <Alert>{history.error}</Alert>}
          </div>
        )}
        {loaded &&
          (rows.length === 0 ? (
            <div className={PANEL_BODY}>
              <EmptyState icon={ClockIcon} title="No transactions yet" text="Orders, deposits and dividends appear here once Scalable reports them." />
            </div>
          ) : (
            <>
              {visible.length === 0 ? (
                <div className={PANEL_BODY}>
                  <EmptyState
                    icon={MagnifyingGlassIcon}
                    title="No matching transactions"
                    text="Nothing matches these filters."
                    action={
                      <button
                        className={btn.secondary}
                        type="button"
                        onClick={() => {
                          setFilter(NO_FILTER);
                          setPage(1);
                        }}
                      >
                        Clear search and filters
                      </button>
                    }
                  />
                </div>
              ) : mode === "feed" ? (
                <>
                  <div className={PANEL_BODY}>
                    <Feed label="Transactions" items={items} />
                  </div>
                  <Pagination page={currentPage} pageCount={pageCount} total={visible.length} pageSize={rowsPerPage} onPage={setPage} />
                </>
              ) : (
                <>
                  <div className={SCROLL_X}>
                    <table className={cx(RECORD_TABLE, resized.className)} style={resized.style}>
                      <thead>
                        <tr>
                          {order.map((id) =>
                            id === "actions" ? (
                              <ColumnHead key={id} id={id} label="Actions" layout={layout} className="min-w-[8.6667rem] text-right">
                                Actions
                              </ColumnHead>
                            ) : (
                              <SortHeader key={id} layout={layout} {...HEADS[id]} column={id} sort={sort} onSort={sortColumn} />
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((row, index) => {
                          const { fields } = row;
                          const { isBuy, isSell } = kindFlags(fields.kind);
                          const name = nameOf(fields);
                          const symbol = symbolOf(fields);
                          return (
                            <tr key={`${currentPage}-${index}`}>
                              {inOrder(order, {
                                when: <td>{fields.when}</td>,
                                kind: <td>{fields.kind ? <Badge tone={isBuy ? "green" : isSell ? "red" : "gray"}>{humanize(fields.kind)}</Badge> : "—"}</td>,
                                name: (
                                  <td>
                                    {fields.isin || name ? (
                                      <SecurityCell
                                        initials={(symbol ?? name ?? fields.isin ?? "").slice(0, 2).toUpperCase()}
                                        logo={logos.get(fields.isin?.toUpperCase() ?? "")}
                                        title={
                                          fields.isin ? (
                                            <button
                                              className="cursor-pointer text-left hover:text-ink-accent-bright hover:underline"
                                              type="button"
                                              onClick={() => openSecurity(fields)}
                                              title="Open details, chart and news"
                                            >
                                              {symbol ?? name ?? fields.isin}
                                            </button>
                                          ) : (
                                            name
                                          )
                                        }
                                        subtitle={fields.isin ? (symbol ? name : name ? fields.isin : undefined) : undefined}
                                      />
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                ),
                                status: <td>{fields.status ? humanize(fields.status) : "—"}</td>,
                                quantity: <td className={TD_NUM}>{fields.quantity ? formatCell(Number(fields.quantity)) : "—"}</td>,
                                limit: <td className={TD_NUM}>{fields.limit ? formatCell(Number(fields.limit)) : "—"}</td>,
                                amount: (
                                  <td className={cx(TD_NUM, fields.amount ? signClass(fields.amount) : "")}>
                                    <SignGlyph value={fields.amount} />
                                    {fields.amount !== null ? formatCell(fields.amount) : "—"}
                                  </td>
                                ),
                                actions: (
                                  <td className={TD_NUM}>
                                    <div className="flex justify-end gap-1.5">{rowActions(row.record, row.portfolioId)}</div>
                                  </td>
                                ),
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Pagination page={currentPage} pageCount={pageCount} total={ordered.length} pageSize={rowsPerPage} onPage={setPage} />
                </>
              )}
            </>
          ))}
        <PanelFooter tradingEnabled={common.tradingEnabled} />
      </section>
      {detail && (
        <DetailsModal
          title="Transaction details"
          tool={TOOL.getTransactionDetails}
          semantic={{ portfolioId: detail.portfolioId, transactionId: detail.id }}
          common={common}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}
