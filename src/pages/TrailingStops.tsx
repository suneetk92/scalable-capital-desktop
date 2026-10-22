import { extension, useExtensionIsinLogos } from "../extensions";
import { ColumnHead, inOrder, resizedTable } from "../ColumnHead";
import { useTableLayout } from "../hooks/useTableLayout";
import { ArrowTrendingDownIcon, ArrowTrendingUpIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { invokeCommand } from "../commands";
import { useApp } from "../app/AppContext";
import { formatMoney } from "../screener";
import { TrailingStopDialog } from "../TrailingStopDialog";
import { errorText } from "../tools";
import { statusLabel, trailLabel, triggerMargin, triggerPrice, type TrailingStatus, type TrailingStop, type TrailSide } from "../trailing";
import { type Common } from "../types";
import { EmptyState, ShareBar } from "../controls";
import { Alert, Badge, btn, cx, NAME_COLUMN, PANEL_BODY, PanelFooter, RECORD_TABLE, SCROLL_X, SecurityCell, TD_NUM, TH_NUM } from "../ui";
import { Section } from "./shared";

const COLUMNS = 8;

const TONE: Record<TrailingStatus, "green" | "yellow" | "gray" | "red"> = { active: "green", selling: "yellow", sold: "gray", attention: "red" };

const COLUMN_IDS = ["name", "status", "quantity", "trail", "high", "trigger", "now", "actions"];
const HEADS: Record<TrailSide, Record<string, { label: string; className?: string }>> = {
  sell: {
    name: { label: "ISIN / name", className: NAME_COLUMN },
    status: { label: "Status" },
    quantity: { label: "Shares", className: TH_NUM },
    trail: { label: "Trails", className: TH_NUM },
    high: { label: "High", className: TH_NUM },
    trigger: { label: "Sells at or below", className: TH_NUM },
    now: { label: "Now", className: TH_NUM },
    actions: { label: "Actions", className: TH_NUM },
  },
  buy: {
    name: { label: "ISIN / name", className: NAME_COLUMN },
    status: { label: "Status" },
    quantity: { label: "Amount", className: TH_NUM },
    trail: { label: "Trails", className: TH_NUM },
    high: { label: "Low", className: TH_NUM },
    trigger: { label: "Buys at or above", className: TH_NUM },
    now: { label: "Now", className: TH_NUM },
    actions: { label: "Actions", className: TH_NUM },
  },
};

function Row({
  order,
  stop,
  logo,
  tradingEnabled,
  onOpen,
  onEdit,
  onRemove,
}: {
  order: string[];
  stop: TrailingStop;
  logo?: string;
  tradingEnabled: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const money = (value: number) => formatMoney(value);
  const watching = stop.status === "active";
  const paused = watching && !tradingEnabled;
  return (
    <>
      <tr className={stop.message ? "[&>td]:border-b-0!" : undefined}>
        {inOrder(order, {
          name: (
            <td>
              <SecurityCell
                initials={stop.name.slice(0, 2).toUpperCase()}
                logo={logo}
                title={
                  <button className="cursor-pointer text-left hover:text-ink-accent-bright hover:underline" type="button" onClick={onOpen} title="Open details, chart and news">
                    {stop.isin}
                  </button>
                }
                subtitle={stop.name}
              />
            </td>
          ),
          status: (
            <td>
              {paused ? (
                <Badge tone="yellow">Paused, Trading is off</Badge>
              ) : (
                <Badge tone={TONE[stop.status]} title={stop.status === "sold" && stop.soldPrice !== null ? formatMoney(stop.soldPrice) : undefined}>
                  {statusLabel(stop.side, stop.status)}
                </Badge>
              )}
            </td>
          ),
          quantity: <td className={TD_NUM}>{stop.side === "buy" ? money(stop.amount ?? 0) : stop.quantity}</td>,
          trail: <td className={TD_NUM}>{trailLabel(stop.trail, money)}</td>,
          high: <td className={TD_NUM}>{money(stop.high)}</td>,
          trigger: <td className={TD_NUM}>{watching ? money(triggerPrice(stop.high, stop.trail, stop.side)) : "—"}</td>,
          now: (
            <td className={TD_NUM}>
              {watching && stop.lastPrice !== null ? (
                <div className="grid justify-items-end gap-1">
                  {money(stop.lastPrice)}
                  <div className="w-16">
                    <ShareBar share={triggerMargin(stop.lastPrice, stop.high, stop.trail, stop.side)} label={`Distance left to the ${stop.side} price`} />
                  </div>
                </div>
              ) : (
                "—"
              )}
            </td>
          ),
          actions: (
            <td className={TD_NUM}>
              <div className="flex justify-end gap-1.5">
                {(watching || stop.status === "attention") && (
                  <button
                    className={btn.trade}
                    type="button"
                    onClick={onEdit}
                    disabled={!tradingEnabled}
                    title={tradingEnabled ? (watching ? "Change the shares and the distance" : "Change it and watch again") : "Read-only mode: turn on Trading to edit"}
                  >
                    Edit
                  </button>
                )}
                <button
                  className={btn.sell}
                  type="button"
                  onClick={onRemove}
                  disabled={stop.status === "selling" || paused}
                  title={paused ? "Read-only mode: turn on Trading to stop watching" : undefined}
                >
                  {watching ? "Stop watching" : "Remove"}
                </button>
              </div>
            </td>
          ),
        })}
      </tr>
      {stop.message && (
        <tr>
          <td colSpan={COLUMNS} className="h-auto! max-w-none! pt-0! pb-3! whitespace-normal! text-justify text-ink-muted">
            {stop.message}
          </td>
        </tr>
      )}
    </>
  );
}

const PANELS = {
  sell: {
    title: "Trailing stop losses",
    add: "New trailing stop",
    addTitle: "Turn on Trading to start a trailing stop",
    icon: ArrowTrendingDownIcon,
    layout: "trailing-stops",
    intro:
      "Scalable has no trailing stop, so the app watches the price itself and sells at market when it falls by your distance below its high. It only works while the app runs, signed in, with Trading on.",
    emptyTitle: "No trailing stops",
    empty: "Start one here or right after a buy, and the app sells at market if the price falls by your distance.",
  },
  buy: {
    title: "Trailing buy stops",
    add: "New trailing buy stop",
    addTitle: "Turn on Trading to start a trailing buy stop",
    icon: ArrowTrendingUpIcon,
    layout: "trailing-buy-stops",
    intro:
      "Scalable has no trailing buy stop, so the app watches the price itself and buys at market, for the amount you set, when it rises by your distance above its low. It only works while the app runs, signed in, with Trading on and enough cash.",
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
};

function TrailingPanel({ side, common, stops, onAdd, onEdit, onRemove, onOpenSecurity }: PanelProps) {
  const { invoke, tradingEnabled } = common;
  const copy = PANELS[side];
  const heads = HEADS[side];
  const { order, layout } = useTableLayout(copy.layout, COLUMN_IDS);
  const resized = resizedTable(layout.widths);
  const logos = useExtensionIsinLogos({ invoke, isins: stops.map((stop) => stop.isin), enabled: Boolean(extension.logos?.useIsinLogos) });
  const active = stops.filter((stop) => stop.status === "active").length;
  return (
    <Section
      title={copy.title}
      flush
      footer={<PanelFooter tradingEnabled={tradingEnabled} />}
      hint={`${active} watching`}
      actions={
        <>
          <button className={btn.primary} type="button" onClick={onAdd} disabled={!tradingEnabled} title={tradingEnabled ? undefined : copy.addTitle}>
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
      ) : (
        <div className={`${SCROLL_X} border-t border-line`}>
          <table className={cx(RECORD_TABLE, resized.className)} style={resized.style}>
            <thead>
              <tr>
                {order.map((id) => (
                  <ColumnHead key={id} id={id} label={heads[id].label} layout={layout} className={heads[id].className}>
                    {heads[id].label}
                  </ColumnHead>
                ))}
              </tr>
            </thead>
            <tbody>
              {stops.map((stop) => (
                <Row
                  key={stop.id}
                  order={order}
                  stop={stop}
                  logo={logos.get(stop.isin.toUpperCase())}
                  tradingEnabled={tradingEnabled}
                  onOpen={() => onOpenSecurity({ isin: stop.isin, name: stop.name })}
                  onEdit={() => onEdit(stop)}
                  onRemove={() => onRemove(stop.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/** The trailing stop losses and trailing buy stops the app watches itself, with a form to start each. */
export function TrailingStops({ common, onOpenSecurity }: { common: Common; onOpenSecurity: (security: { isin: string; name: string }) => void }) {
  const { invoke, portfolios, held, tradingEnabled } = common;
  const { stops, problem, reload, checkError, setCheckError } = useApp().data.trailing;
  const [adding, setAdding] = useState<TrailSide | null>(null);
  const [editing, setEditing] = useState<TrailingStop | null>(null);

  async function remove(id: string) {
    setCheckError(null);
    try {
      await invokeCommand(invoke, "remove_trailing_stop", { id });
    } catch (removeError) {
      setCheckError(errorText(removeError));
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
      tradingEnabled={tradingEnabled}
      editing={stop ?? undefined}
      onClose={onClose}
      onAdded={() => void reload()}
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
        />
      ))}
      {editing && dialog(editing.side, editing, () => setEditing(null))}
      {adding && dialog(adding, null, () => setAdding(null))}
    </>
  );
}
