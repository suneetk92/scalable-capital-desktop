import { memo } from "react";
import { ChevronRightIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { RowCheckbox } from "./controls";
import { extension } from "./extensions";
import type { Cell } from "./marketColumns";
import { type MarketRecord, type TableColumn, type Tone } from "./marketColumns";
import { formatChange, formatMoney, formatNumber, type ScreenerRow } from "./screener";
import { Badge, btn, cx, SecurityCell, securityTypeTone, SignGlyph, signClass, TD_NUM } from "./ui";
import { formatSignedMoney } from "./format";

function changeTone(change: number | null) {
  return change === null ? "text-ink-faint!" : signClass(change, "text-ink-soft!");
}

export const TONE_CLASS: Record<Tone, string> = { "": "", up: "text-up!", down: "text-down!", muted: "text-ink-muted!" };
export const isTextColumn = (column: TableColumn) => column.format === "text" || column.format === "bool" || column.text === true;

export const ScreenerRowView = memo(function ScreenerRowView({
  row,
  shownColumns,
  marketRecord,
  marketCurrency,
  formatExtensionCell,
  logos,
  isinLogos,
  selected,
  view,
  tradingEnabled,
  canRemove,
  hasRowActions,
  onToggleRow,
  onOpenSecurity,
  onOpenOrder,
  onRemove,
  index,
  sectionKey,
  movable = false,
  dropTarget = false,
  dragging = false,
}: {
  row: ScreenerRow;
  shownColumns: TableColumn[];
  marketRecord: MarketRecord | undefined;
  marketCurrency: string;
  formatExtensionCell?: (column: TableColumn, record: MarketRecord | undefined, currency: string) => Cell;
  logos: ReadonlyMap<string, string>;
  isinLogos: ReadonlyMap<string, string>;
  selected: boolean;
  view: "portfolio" | "watchlist";
  tradingEnabled: boolean;
  canRemove: boolean;
  hasRowActions: boolean;
  onToggleRow: (rowId: string, checked: boolean) => void;
  onOpenSecurity: (row: ScreenerRow) => void;
  onOpenOrder: (side: "buy" | "sell", row: ScreenerRow) => void;
  onRemove: (row: ScreenerRow) => void;
  index: number;
  /** The group section the row is shown in; drag and drop finds its target by it. */
  sectionKey?: string;
  /** The row can be dragged to another group. */
  movable?: boolean;
  /** The row's section is where the row or group being dragged would go. */
  dropTarget?: boolean;
  /** The row is being dragged. */
  dragging?: boolean;
}) {
  return (
    <tr
      className={cx("group/row", movable && "cursor-grab", dropTarget && "bg-accent-bg!", dragging && "opacity-50")}
      aria-selected={selected}
      data-index={index}
      data-section={sectionKey}
      aria-rowindex={index + 2}
    >
      <td className="w-11 px-3!">
        <RowCheckbox label={`Select ${row.name}`} checked={selected} onChange={(checked) => onToggleRow(row.rowId, checked)} />
      </td>
      <td>
        <SecurityCell
          initials={row.symbol.slice(0, 2).toUpperCase()}
          logo={extension.logos?.logoOf?.(marketRecord, row.isin, logos, isinLogos)}
          badge={extension.securityBadge?.(marketRecord, row) ?? null}
          title={
            <button
              className="cursor-pointer text-left enabled:hover:[&_strong]:text-ink-accent-bright enabled:hover:[&_strong]:underline disabled:cursor-default"
              type="button"
              disabled={!row.isin}
              onClick={() => onOpenSecurity(row)}
              title="Open details, chart and news"
            >
              <strong className="font-semibold text-ink-strong">{row.symbol}</strong>
            </button>
          }
          subtitle={row.name !== row.symbol ? row.name : row.exchange}
        />
      </td>
      {shownColumns.map((column) => {
        if (column.source !== "scalable") {
          const cell = formatExtensionCell?.(column, marketRecord, marketCurrency) ?? { text: "—", tone: "" as const };
          return (
            <td key={column.id} className={cx(isTextColumn(column) ? "text-left" : TD_NUM, TONE_CLASS[cell.tone])}>
              {cell.text}
            </td>
          );
        }
        switch (column.id) {
          case "price":
            return (
              <td key={column.id} className={TD_NUM}>
                {formatMoney(row.lastPrice, row.currency)}
              </td>
            );
          case "bid":
          case "ask":
            return (
              <td key={column.id} className={TD_NUM}>
                {formatMoney(row[column.id] ?? null, row.currency)}
              </td>
            );
          case "spreadPct":
            return (
              <td key={column.id} className={TD_NUM}>
                {row.spreadPct == null ? "—" : `${formatNumber(row.spreadPct, 2, 2)}%`}
              </td>
            );
          case "change":
            return (
              <td key={column.id} className={cx(TD_NUM, changeTone(row.change))}>
                {formatChange(row.change)}
              </td>
            );
          case "quantity":
            return (
              <td key={column.id} className={TD_NUM}>
                {formatNumber(row.quantity)}
              </td>
            );
          case "value":
            return (
              <td key={column.id} className={cx(TD_NUM, "font-label! text-ink-strong!")}>
                {formatMoney(row.value, row.currency)}
              </td>
            );
          case "avgPrice":
            return (
              <td key={column.id} className={TD_NUM}>
                {formatMoney(row.avgPrice ?? null, row.currency)}
              </td>
            );
          case "cost":
            return (
              <td key={column.id} className={TD_NUM}>
                {formatMoney(row.cost ?? null, row.currency)}
              </td>
            );
          case "sinceBuy":
            return (
              <td key={column.id} className={cx(TD_NUM, changeTone(row.sinceBuy ?? null))}>
                <SignGlyph value={row.sinceBuy} />
                {formatSignedMoney(row.sinceBuy ?? null, row.currency)}
              </td>
            );
          case "sinceBuyPct":
            return (
              <td key={column.id} className={cx(TD_NUM, changeTone(row.sinceBuyPct ?? null))}>
                <SignGlyph value={row.sinceBuyPct} />
                {formatChange(row.sinceBuyPct ?? null)}
              </td>
            );
          case "weight":
            return (
              <td key={column.id} className={TD_NUM}>
                {row.weight == null ? "—" : `${formatNumber(row.weight * 100, 1, 1)}%`}
              </td>
            );
          case "today":
            return (
              <td key={column.id} className={cx(TD_NUM, changeTone(row.today ?? null))}>
                <SignGlyph value={row.today} />
                {formatSignedMoney(row.today ?? null, row.currency)}
              </td>
            );
          default:
            return <td key={column.id}>{row.exchange ? <Badge tone={securityTypeTone(row.exchange)}>{row.exchange}</Badge> : "—"}</td>;
        }
      })}
      {hasRowActions && (
        <td className={TD_NUM}>
          <div className="flex justify-end gap-1.5 [&>*]:shrink-0">
            {tradingEnabled && (
              <button className={btn.buy} type="button" disabled={!row.isin} onClick={() => onOpenOrder("buy", row)} aria-label={`Buy ${row.name}`}>
                Buy
              </button>
            )}
            {tradingEnabled && view === "portfolio" && (
              <button className={btn.sell} type="button" disabled={!row.isin} onClick={() => onOpenOrder("sell", row)} aria-label={`Sell ${row.name}`}>
                Sell
              </button>
            )}
            {view === "watchlist" && canRemove && (
              <button className={btn.trade} type="button" disabled={!row.isin} onClick={() => onRemove(row)} aria-label={`Remove ${row.name} from watchlist`}>
                <XMarkIcon className="mr-1 inline size-3.5 align-[-0.1333rem]" aria-hidden="true" /> Remove
              </button>
            )}
          </div>
        </td>
      )}
      <td className="w-12 pl-0! text-right">
        <button
          className="grid size-7 cursor-pointer place-items-center rounded-control text-ink-muted opacity-0 group-hover/row:opacity-100 hover:bg-hover hover:text-ink-strong focus-visible:opacity-100 disabled:hidden [&_svg]:size-[1.2rem]"
          type="button"
          disabled={!row.isin}
          onClick={() => onOpenSecurity(row)}
          aria-label={`Open details for ${row.name}`}
        >
          <ChevronRightIcon />
        </button>
      </td>
    </tr>
  );
});
