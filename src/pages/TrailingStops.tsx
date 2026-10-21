import { ColumnHead, inOrder, resizedTable } from "../ColumnHead";
import { useTableLayout } from "../hooks/useTableLayout";
import { ArrowTrendingDownIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { invokeCommand } from "../commands";
import { useTrailingStops } from "../hooks/useTrailingStops";
import { formatMoney, parseSearch } from "../screener";
import { TrailingStopDialog } from "../TrailingStopDialog";
import { errorText } from "../tools";
import { STATUS_LABEL, trailLabel, triggerPrice, type TrailingStatus, type TrailingStop } from "../trailing";
import { type Common } from "../types";
import { EmptyState } from "../controls";
import { Alert, Badge, btn, cx, NAME_COLUMN, PANEL_BODY, PanelFooter, RECORD_TABLE, SCROLL_X, SecurityCell, TD_NUM, TH_NUM } from "../ui";
import { Section } from "./shared";

const COLUMNS = 8;

const TONE: Record<TrailingStatus, "green" | "yellow" | "gray" | "red"> = { active: "green", selling: "yellow", sold: "gray", attention: "red" };

const COLUMN_IDS = ["name", "status", "quantity", "trail", "high", "trigger", "now", "actions"];
const HEADS: Record<string, { label: string; className?: string }> = {
  name: { label: "ISIN / name", className: NAME_COLUMN },
  status: { label: "Status" },
  quantity: { label: "Shares", className: TH_NUM },
  trail: { label: "Trails", className: TH_NUM },
  high: { label: "High", className: TH_NUM },
  trigger: { label: "Sells at or below", className: TH_NUM },
  now: { label: "Now", className: TH_NUM },
  actions: { label: "Actions", className: TH_NUM },
};

function Row({ order, stop, onRemove }: { order: string[]; stop: TrailingStop; onRemove: () => void }) {
  const money = (value: number) => formatMoney(value);
  const watching = stop.status === "active";
  return (
    <>
      <tr className={stop.message ? "[&>td]:border-b-0!" : undefined}>
        {inOrder(order, {
          name: (
            <td>
              <SecurityCell initials={stop.name.slice(0, 2).toUpperCase()} title={stop.isin} subtitle={stop.name} />
            </td>
          ),
          status: (
            <td>
              <Badge tone={TONE[stop.status]}>{STATUS_LABEL[stop.status]}</Badge>
            </td>
          ),
          quantity: <td className={TD_NUM}>{stop.quantity}</td>,
          trail: <td className={TD_NUM}>{trailLabel(stop.trail, money)}</td>,
          high: <td className={TD_NUM}>{money(stop.high)}</td>,
          trigger: <td className={TD_NUM}>{watching ? money(triggerPrice(stop.high, stop.trail)) : "—"}</td>,
          now: <td className={TD_NUM}>{watching && stop.lastPrice !== null ? money(stop.lastPrice) : "—"}</td>,
          actions: (
            <td className={TD_NUM}>
              <div className="flex justify-end gap-1.5">
                <button className={btn.sell} type="button" onClick={onRemove} disabled={stop.status === "selling"}>
                  {watching ? "Stop watching" : "Remove"}
                </button>
              </div>
            </td>
          ),
        })}
      </tr>
      {stop.message && (
        <tr>
          <td colSpan={COLUMNS} className="h-auto! max-w-none! pt-0! pb-3! whitespace-normal! text-ink-muted">
            {stop.message}
          </td>
        </tr>
      )}
    </>
  );
}

/** The trailing stops the app watches itself, with a form to start one. */
export function TrailingStops({ common }: { common: Common }) {
  const { invoke, portfolios, tradingEnabled } = common;
  const { stops, problem, reload } = useTrailingStops(invoke);
  const { order, layout } = useTableLayout("trailing-stops", COLUMN_IDS);
  const resized = resizedTable(layout.widths);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setError(null);
    try {
      await invokeCommand(invoke, "remove_trailing_stop", { id });
    } catch (removeError) {
      setError(errorText(removeError));
    }
    void reload();
  }

  const active = stops.filter((stop) => stop.status === "active").length;
  return (
    <>
      <Section
        title="Trailing stop losses"
        flush
        footer={<PanelFooter tradingEnabled={tradingEnabled} />}
        hint={`${active} watching`}
        actions={
          <button className={btn.primary} type="button" onClick={() => setAdding(true)} disabled={!tradingEnabled} title={tradingEnabled ? undefined : "Turn on Trading to start a trailing stop"}>
            New trailing stop
          </button>
        }
      >
        <div className={PANEL_BODY}>
          <p className="text-ink-muted">
            Scalable has no trailing stop, so the app watches the price itself and sells at market when it falls by your distance below its high. It only works while the app runs, signed in, with
            Trading on.
          </p>
          {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}
          {problem && <Alert>{problem}</Alert>}
        </div>
        {stops.length === 0 ? (
          <EmptyState icon={ArrowTrendingDownIcon} title="No trailing stops" text="Start one here or right after a buy, and the app sells at market if the price falls by your distance." />
        ) : (
          <div className={`${SCROLL_X} border-t border-line`}>
            <table className={cx(RECORD_TABLE, resized.className)} style={resized.style}>
              <thead>
                <tr>
                  {order.map((id) => (
                    <ColumnHead key={id} id={id} label={HEADS[id].label} layout={layout} className={HEADS[id].className}>
                      {HEADS[id].label}
                    </ColumnHead>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stops.map((stop) => (
                  <Row key={stop.id} order={order} stop={stop} onRemove={() => void remove(stop.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {adding && (
        <TrailingStopDialog
          security={null}
          portfolioId={portfolios[0]?.portfolioId ?? ""}
          quantity=""
          portfolios={portfolios}
          invoke={invoke}
          parseSearch={parseSearch}
          tradingEnabled={tradingEnabled}
          onClose={() => setAdding(false)}
          onAdded={() => void reload()}
        />
      )}
    </>
  );
}
