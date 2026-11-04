import { extension, useExtensionIsinLogos } from "../../../../src/extensions";
import { ColumnHead, inOrder, resizedTable } from "../../../../src/ColumnHead";
import { renameStoredColumns, useTableLayout } from "../../../../src/hooks/useTableLayout";
import { ArrowTrendingDownIcon, ArrowTrendingUpIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { invokeCommand } from "./commands";
import { csvCell, formatMoney, formatNumber } from "../../../../src/screener";
import { formatDateTime, pluralize } from "../../../../src/format";
import { TrailingStopDialog } from "./TrailingStopDialog";
import { TrailingTransactionDialog } from "./TrailingTransactionDialog";
import { errorText } from "../../../../src/tools";
import type { useTrailingStops } from "./useTrailingStops";
import {
  filterTrailingStops,
  statusLabel,
  trailLabel,
  trailingCsvRows,
  trailingStopNotice,
  triggerBarShare,
  triggerPrice,
  waitingNote,
  type TrailingStatus,
  type TrailingStatusFilter,
  type TrailingStop,
  type TrailSide,
} from "./trailing";
import { type Common } from "../../../../src/types";
import { EmptyState, FILTER_TITLE, FiltersPopover, Pagination, RadioList, SearchBox, ShareBar, SortHeader } from "../../../../src/controls";
import { Alert, Badge, btn, cx, NAME_COLUMN, PANEL_BODY, PanelFooter, RECORD_TABLE, SCROLL_X, SecurityCell, TD_NUM, TH_NUM } from "../../../../src/ui";
import { Section } from "../../../../src/pages/shared";
import { matchesText } from "../../../../src/textSearch";
import { executionPriceNote, isFilled, orderStateLabel, useOrderStates, type OrderInfo } from "./orderState";
import { paginate } from "../../../../src/paging";
import { oneOf, useStoredState } from "../../../../src/hooks/useStoredState";
import { nextSort, parseSortState, sortItems, type SortState } from "../../../../src/sorting";

const TONE: Record<TrailingStatus, "green" | "yellow" | "gray" | "red"> = { active: "green", selling: "yellow", sold: "gray", attention: "red" };

const COLUMN_IDS = ["name", "status", "quantity", "trail", "high", "trigger", "now", "executedAt", "executionPrice", "actions"];
const HEADS: Record<TrailSide, Record<string, { label: string; className?: string }>> = {
  sell: {
    name: { label: "Symbol / name", className: NAME_COLUMN },
    status: { label: "Status" },
    quantity: { label: "Shares", className: TH_NUM },
    trail: { label: "Distance", className: TH_NUM },
    high: { label: "Highest price", className: TH_NUM },
    trigger: { label: "Sells at or below", className: TH_NUM },
    now: { label: "Now", className: TH_NUM },
    executedAt: { label: "Execution time", className: TH_NUM },
    executionPrice: { label: "Execution price", className: TH_NUM },
    actions: { label: "Actions", className: TH_NUM },
  },
  buy: {
    name: { label: "Symbol / name", className: NAME_COLUMN },
    status: { label: "Status" },
    quantity: { label: "Amount / shares", className: TH_NUM },
    trail: { label: "Distance", className: TH_NUM },
    high: { label: "Lowest price", className: TH_NUM },
    trigger: { label: "Buys at or above", className: TH_NUM },
    now: { label: "Now", className: TH_NUM },
    executedAt: { label: "Execution time", className: TH_NUM },
    executionPrice: { label: "Execution price", className: TH_NUM },
    actions: { label: "Actions", className: TH_NUM },
  },
};

function displayStatus(stop: TrailingStop, orderInfo: OrderInfo | undefined, tradingEnabled: boolean): string {
  const waiting = waitingNote(stop, tradingEnabled);
  if (waiting) return waiting;
  if (stop.status === "active" && stop.message) return `Could not ${stop.side === "buy" ? "buy" : "sell"}, retrying`;
  return `${statusLabel(stop.side, stop.status, isFilled(orderInfo))}${stop.status === "sold" && orderInfo ? ` · ${orderStateLabel(orderInfo.state)}` : ""}`;
}

function Row({
  order,
  stop,
  logo,
  tradingEnabled,
  manageEnabled,
  onOpen,
  onEdit,
  onRemove,
  onDetails,
  orderInfo,
}: {
  order: string[];
  stop: TrailingStop;
  logo?: string;
  tradingEnabled: boolean;
  manageEnabled: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onDetails: () => void;
  /** Where the placed order stands at Scalable, with any reported fill data. */
  orderInfo?: OrderInfo;
}) {
  const money = (value: number) => formatMoney(value);
  const watching = stop.status === "active";
  const waiting = waitingNote(stop, tradingEnabled);
  const buying = stop.side === "buy";
  const verb = buying ? "buy" : "sell";
  const soldNote =
    stop.status === "sold"
      ? `${buying ? "Buy" : "Sell"} order placed${stop.executedAt !== null ? ` ${formatDateTime(stop.executedAt * 1000)}` : ""}${stop.quotePrice !== null ? ` at a quote of about ${money(stop.quotePrice)}` : ""}.${orderInfo ? ` Scalable reports ${orderStateLabel(orderInfo.state).toLowerCase()}.` : ""}`
      : null;
  const watchNote = `Watching the price. The app will ${verb} at market once it ${buying ? "reaches" : "falls to"} ${money(triggerPrice(stop.high, stop.trail, stop.side))}.`;
  const defaultTitle: Record<TrailingStatus, string> = {
    active: watchNote,
    selling: `The trigger was hit and the ${verb} order is being placed now.`,
    sold: buying ? "The buy order was placed." : "The sell order was placed.",
    attention: `The app did not ${verb} automatically. Check Scalable before doing anything else.`,
  };
  const waitingTitle = stop.triggerReached
    ? `The price reached the trigger, but Full access is off or the exchange is closed. The app will ${verb} at the next check once Full access is on, if the price is still past the trigger.`
    : `Full access is off or the exchange is closed. The app still follows the price and moves the ${buying ? "low" : "high"}, but will not ${verb} until Full access is on.`;
  const statusTitle = waiting ? `${stop.message ?? ""}${stop.message ? "\n" : ""}${waitingTitle}` : (soldNote ?? stop.message ?? defaultTitle[stop.status]);
  return (
    <>
      <tr>
        {inOrder(order, {
          name: (
            <td>
              <SecurityCell
                initials={stop.name.slice(0, 2).toUpperCase()}
                logo={logo}
                title={
                  <button className="cursor-pointer text-right hover:text-ink-accent-bright hover:underline" type="button" onClick={onOpen} title={`Open details, chart and news · ${stop.isin}`}>
                    {stop.name}
                  </button>
                }
                subtitle={stop.isin}
              />
            </td>
          ),
          status: (
            <td>
              {waiting ? (
                <Badge tone="yellow" title={statusTitle}>
                  {waiting}
                </Badge>
              ) : watching && stop.message ? (
                <Badge tone="yellow" title={statusTitle}>
                  {`Could not ${verb}, retrying`}
                </Badge>
              ) : (
                <Badge tone={TONE[stop.status]} title={statusTitle}>
                  {statusLabel(stop.side, stop.status, isFilled(orderInfo))}
                  {stop.status === "sold" && orderInfo ? ` · ${orderStateLabel(orderInfo.state)}` : ""}
                </Badge>
              )}
            </td>
          ),
          quantity: (
            <td className={`${TD_NUM} whitespace-nowrap`}>
              {stop.side === "buy" ? (stop.amount !== null ? money(stop.amount) : `${formatNumber(stop.quantity)} shares`) : formatNumber(stop.quantity)}
            </td>
          ),
          trail: <td className={`${TD_NUM} whitespace-nowrap`}>{trailLabel(stop.trail, money)}</td>,
          high: <td className={`${TD_NUM} whitespace-nowrap`}>{money(stop.high)}</td>,
          trigger: <td className={`${TD_NUM} whitespace-nowrap`}>{watching ? money(triggerPrice(stop.high, stop.trail, stop.side)) : "—"}</td>,
          now: (
            <td className={`${TD_NUM} whitespace-nowrap`}>
              {watching && stop.lastPrice !== null ? (
                <div className="grid justify-items-end gap-1">
                  {money(stop.lastPrice)}
                  <div className="w-16">
                    <ShareBar share={triggerBarShare(stop.lastPrice, stop.high, stop.trail, stop.side)} label={buying ? "Progress from the low to the buy price" : "Distance left to the sell price"} />
                  </div>
                </div>
              ) : (
                "—"
              )}
            </td>
          ),
          executedAt: (
            <td className={`${TD_NUM} whitespace-nowrap`} title={stop.status === "sold" ? (orderInfo?.executionTime ? undefined : "Not reported by Scalable") : "No completed order to report"}>
              {stop.status === "sold" && orderInfo?.executionTime ? formatDateTime(orderInfo.executionTime) : "—"}
            </td>
          ),
          executionPrice: (
            <td
              className={`${TD_NUM} whitespace-nowrap`}
              title={
                stop.status === "sold" && orderInfo?.executionPrice != null
                  ? (executionPriceNote(orderInfo) ?? undefined)
                  : stop.status === "sold"
                    ? "Not reported by Scalable"
                    : "No completed order to report"
              }
            >
              {stop.status === "sold" && orderInfo?.executionPrice !== null && orderInfo?.executionPrice !== undefined ? formatMoney(orderInfo.executionPrice, orderInfo.currency ?? "EUR") : "—"}
            </td>
          ),
          actions: (
            <td className={TD_NUM}>
              <div className="flex justify-end gap-1.5">
                {stop.status === "sold" && (
                  <button className={btn.trade} type="button" onClick={onDetails} title={buying ? "Show the buy transaction" : "Show the sell transaction"}>
                    Details
                  </button>
                )}
                {(watching || stop.status === "attention") && (
                  <button
                    className={btn.trade}
                    type="button"
                    onClick={onEdit}
                    disabled={!manageEnabled}
                    title={manageEnabled ? (watching ? "Change the size and the distance" : "Change it and watch again") : "Read-only mode: switch to Restricted or Full access to edit"}
                  >
                    Edit
                  </button>
                )}
                <button className={btn.sell} type="button" onClick={onRemove} disabled={stop.status === "selling"}>
                  {watching ? "Stop watching" : "Remove"}
                </button>
              </div>
            </td>
          ),
        })}
      </tr>
    </>
  );
}

const PANELS = {
  sell: {
    title: "Trailing stop losses",
    add: "New trailing stop",
    addTitle: "Switch to Restricted or Full access to start a trailing stop",
    icon: ArrowTrendingDownIcon,
    layout: "trailing-stops",
    intro:
      "Scalable has no trailing stop, so the app watches the price itself and sells at market when it falls by your distance below its high. It only works while the app runs and is signed in. The high follows the price at any access level; the sale needs Full access while the exchange is open.",
    emptyTitle: "No trailing stops",
    empty: "Start one here or right after a buy, and the app sells at market if the price falls by your distance.",
  },
  buy: {
    title: "Trailing buy stops",
    add: "New trailing buy stop",
    addTitle: "Switch to Restricted or Full access to start a trailing buy stop",
    icon: ArrowTrendingUpIcon,
    layout: "trailing-buy-stops",
    intro:
      "Scalable has no trailing buy stop, so the app watches the price itself and buys at market, for the amount or whole shares you choose, when it rises by your distance above its low. It only works while the app runs and is signed in. The low follows the price at any access level; the purchase needs Full access while the exchange is open, and enough cash when you choose an amount.",
    emptyTitle: "No trailing buy stops",
    empty: "Start one here to buy into a recovery without picking the bottom: the app follows the price down and buys when it turns up by your distance.",
  },
} as const;

type PanelProps = {
  side: TrailSide;
  common: Common;
  stops: TrailingStop[];
  onAdd: () => void;
  onEdit: (stop: TrailingStop) => void;
  onRemove: (id: string) => void;
  onOpenSecurity: (security: { isin: string; name: string }) => void;
  onDetails: (stop: TrailingStop) => void;
  orderStates: ReadonlyMap<string, OrderInfo>;
};

function TrailingPanel({ side, common, stops, onAdd, onEdit, onRemove, onOpenSecurity, onDetails, orderStates }: PanelProps) {
  const { invoke, tradingEnabled, manageEnabled } = common;
  const copy = PANELS[side];
  const heads = HEADS[side];
  renameStoredColumns(copy.layout, { placed: "executedAt", atAbout: "executionPrice" });
  const { order, layout } = useTableLayout(copy.layout, COLUMN_IDS);
  const resized = resizedTable(layout.widths);
  const logos = useExtensionIsinLogos({ invoke, isins: stops.map((stop) => stop.isin), enabled: Boolean(extension.logos?.useIsinLogos) });
  const active = stops.filter((stop) => stop.status === "active").length;
  const [search, setSearch] = useStoredState(`${copy.layout}.search`, "");
  const [statusFilter, setStatusFilter] = useStoredState<TrailingStatusFilter>(`${copy.layout}.statusFilter`, "all", oneOf(["all", "active", "selling", "sold", "attention"] as const));
  const [sort, setSort] = useStoredState<SortState>(`${copy.layout}.sort`, null, parseSortState);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [common.pageSize, search, statusFilter, sort]);
  const filtered = filterTrailingStops(stops, statusFilter).filter((stop) => {
    const orderInfo = orderStates.get(stop.id);
    return matchesText(search, [stop.name, stop.isin, statusLabel(side, stop.status, isFilled(orderInfo)), orderInfo ? orderStateLabel(orderInfo.state) : ""]);
  });
  const sorted = sortItems(filtered, sort, (stop, key) => {
    const orderInfo = orderStates.get(stop.id);
    switch (key) {
      case "name":
        return stop.name;
      case "status":
        return displayStatus(stop, orderInfo, tradingEnabled);
      case "quantity":
        return stop.side === "buy" ? (stop.amount ?? stop.quantity) : stop.quantity;
      case "trail":
        return stop.trail.value;
      case "high":
        return stop.high;
      case "trigger":
        return stop.status === "active" ? triggerPrice(stop.high, stop.trail, stop.side) : null;
      case "now":
        return stop.status === "active" ? stop.lastPrice : null;
      case "executedAt":
        return orderInfo?.executionTime;
      case "executionPrice":
        return orderInfo?.executionPrice;
      default:
        return null;
    }
  });
  const pageData = paginate(sorted, page, common.pageSize);
  const filtering = search.trim() !== "" || statusFilter !== "all";
  const hint = filtering ? `${pluralize(sorted.length, "stop")} match (of ${pluralize(stops.length, "stop")})` : `${pluralize(stops.length, "stop")} · ${active} watching`;

  async function copyCsv() {
    const details = new Map(
      stops.map((stop) => {
        const orderInfo = orderStates.get(stop.id);
        return [
          stop.id,
          {
            status: displayStatus(stop, orderInfo, tradingEnabled),
            executionTime: orderInfo?.executionTime ? formatDateTime(orderInfo.executionTime) : null,
            executionPrice: orderInfo?.executionPrice == null ? null : formatMoney(orderInfo.executionPrice, orderInfo.currency ?? "EUR"),
          },
        ] as const;
      }),
    );
    try {
      await navigator.clipboard.writeText(
        trailingCsvRows(sorted, details)
          .map((row) => row.map(csvCell).join(","))
          .join("\n"),
      );
      common.actions.notify({ kind: "ok", text: `${pluralize(sorted.length, "stop")} copied as CSV` });
    } catch {
      common.actions.notify({ kind: "error", text: "Could not copy to the clipboard." });
    }
  }

  const clearSearchAndFilters = () => {
    setSearch("");
    setStatusFilter("all");
  };
  return (
    <Section
      title={copy.title}
      toolbar={
        <div className="flex min-h-[3.6667rem] items-center justify-end gap-3.5 border-b border-line px-4 max-[900px]:flex-col max-[900px]:items-start">
          <div className="flex items-center gap-2 max-[900px]:w-full max-[900px]:pb-2.5" role="search" aria-label={`Search and filter ${copy.title.toLowerCase()}`}>
            <SearchBox value={search} onChange={setSearch} placeholder="Search symbol or name" label={`Search ${copy.title.toLowerCase()} by symbol or name`} />
            <FiltersPopover count={Number(statusFilter !== "all")} onClear={() => setStatusFilter("all")}>
              <div className={FILTER_TITLE}>Status</div>
              <RadioList<TrailingStatusFilter>
                label="Status"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  ["all", "All"],
                  ["active", "Watching"],
                  ["selling", side === "buy" ? "Buying" : "Selling"],
                  ["sold", "Order placed / done"],
                  ["attention", "Needs you"],
                ]}
              />
            </FiltersPopover>
            <button className={btn.secondary} type="button" onClick={() => void copyCsv()} disabled={sorted.length === 0} title="Copy the stops shown as CSV">
              Copy CSV
            </button>
          </div>
        </div>
      }
      flush
      footer={<PanelFooter tradingEnabled={tradingEnabled} manageEnabled={manageEnabled} />}
      hint={hint}
      actions={
        <>
          <button className={btn.primary} type="button" onClick={onAdd} disabled={!manageEnabled} title={manageEnabled ? undefined : copy.addTitle}>
            {copy.add}
          </button>
        </>
      }
    >
      <div className={PANEL_BODY}>
        <p className="text-ink-muted">{copy.intro}</p>
      </div>
      {stops.length === 0 ? (
        <EmptyState icon={copy.icon} title={copy.emptyTitle} text={copy.empty} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={MagnifyingGlassIcon}
          title="No matching stops"
          text="Try another search or clear the filters."
          action={
            <button className={btn.secondary} type="button" onClick={clearSearchAndFilters}>
              Clear search and filters
            </button>
          }
        />
      ) : (
        <>
          <div className={`${SCROLL_X} border-t border-line`}>
            <table className={cx(RECORD_TABLE, resized.className)} style={resized.style}>
              <thead>
                <tr>
                  {order.map((id) =>
                    id === "actions" ? (
                      <ColumnHead key={id} id={id} label={heads[id].label} layout={layout} className={heads[id].className}>
                        {heads[id].label}
                      </ColumnHead>
                    ) : (
                      <SortHeader
                        key={id}
                        layout={layout}
                        label={heads[id].label}
                        column={id}
                        sort={sort}
                        onSort={(column) => setSort((current) => nextSort(current, column))}
                        numeric={heads[id].className === TH_NUM}
                        iconAfter={id === "name"}
                        className="whitespace-nowrap"
                      />
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {pageData.rows.map((stop) => (
                  <Row
                    key={stop.id}
                    order={order}
                    stop={stop}
                    logo={logos.get(stop.isin.toUpperCase())}
                    tradingEnabled={tradingEnabled}
                    manageEnabled={manageEnabled}
                    onOpen={() => onOpenSecurity({ isin: stop.isin, name: stop.name })}
                    onEdit={() => onEdit(stop)}
                    onRemove={() => onRemove(stop.id)}
                    onDetails={() => onDetails(stop)}
                    orderInfo={orderStates.get(stop.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={pageData.page} pageCount={pageData.pageCount} total={sorted.length} pageSize={pageData.size} onPage={setPage} />
        </>
      )}
    </Section>
  );
}

/** The trailing stop losses and trailing buy stops the app watches itself, with a form to start each. */
export function TrailingStops({
  common,
  trailing,
  onOpenSecurity,
}: {
  common: Common;
  trailing: ReturnType<typeof useTrailingStops>;
  onOpenSecurity: (security: { isin: string; name: string }) => void;
}) {
  const { invoke, portfolios, held, manageEnabled } = common;
  const { stops, problem, reload, checkError, setCheckError } = trailing;
  const [adding, setAdding] = useState<TrailSide | null>(null);
  const [editing, setEditing] = useState<TrailingStop | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const orderStates = useOrderStates(common, stops);
  const viewed = stops.find((stop) => stop.id === viewing);

  async function remove(id: string) {
    setCheckError(null);
    const stop = stops.find((item) => item.id === id);
    const name = stop?.name ?? id;
    const title = stop?.side === "buy" ? "Trailing buy stop removed" : "Trailing stop removed";
    try {
      await invokeCommand(invoke, "remove_trailing_stop", { id });
      common.actions.notify({ kind: "ok", title, text: name });
    } catch (removeError) {
      const message = errorText(removeError);
      setCheckError(message);
      common.actions.notify({ kind: "error", title: "Could not remove trailing stop", text: `${name}: ${message}` });
    }
    void reload();
  }

  const dialog = (side: TrailSide, stop: TrailingStop | null, onClose: () => void) => (
    <TrailingStopDialog
      side={side}
      security={null}
      portfolioId={stop?.portfolioId ?? portfolios[0]?.portfolioId ?? ""}
      quantity=""
      portfolios={portfolios}
      held={held}
      invoke={invoke}
      manageEnabled={manageEnabled}
      editing={stop ?? undefined}
      onClose={onClose}
      onAdded={(name) => {
        common.actions.notify(trailingStopNotice(stop ? "changed" : "added", side, name));
        void reload();
      }}
    />
  );

  return (
    <>
      {(checkError || problem) && (
        <div className="mb-4 grid gap-2">
          {checkError && <Alert onDismiss={() => setCheckError(null)}>{checkError}</Alert>}
          {problem && <Alert>{problem}</Alert>}
        </div>
      )}
      {(["sell", "buy"] as const).map((side) => (
        <TrailingPanel
          key={side}
          side={side}
          common={common}
          stops={stops.filter((stop) => stop.side === side)}
          onAdd={() => setAdding(side)}
          onEdit={setEditing}
          onRemove={(id) => void remove(id)}
          onOpenSecurity={onOpenSecurity}
          onDetails={(stop) => setViewing(stop.id)}
          orderStates={orderStates}
        />
      ))}
      {viewed && <TrailingTransactionDialog stop={viewed} order={orderStates.get(viewed.id)} onClose={() => setViewing(null)} />}
      {editing && dialog(editing.side, editing, () => setEditing(null))}
      {adding && dialog(adding, null, () => setAdding(null))}
    </>
  );
}
