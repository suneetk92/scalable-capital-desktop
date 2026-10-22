import { extension, useExtensionIsinLogos } from "../extensions";
import { ColumnHead, inOrder, resizedTable } from "../ColumnHead";
import { useTableLayout } from "../hooks/useTableLayout";
import { ArrowTrendingDownIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { invokeCommand } from "../commands";
import { useTrailingStops } from "../hooks/useTrailingStops";
import { formatMoney } from "../screener";
import { TrailingStopDialog } from "../TrailingStopDialog";
import { errorText } from "../tools";
import { STATUS_LABEL, trailLabel, triggerMargin, triggerPrice, type TrailingStatus, type TrailingStop } from "../trailing";
import { type Common } from "../types";
import { EmptyState, ShareBar } from "../controls";
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

function Row({ order, stop, logo, tradingEnabled, onOpen, onRemove }: { order: string[]; stop: TrailingStop; logo?: string; tradingEnabled: boolean; onOpen: () => void; onRemove: () => void }) {
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
          status: <td>{paused ? <Badge tone="yellow">Paused, Trading is off</Badge> : <Badge tone={TONE[stop.status]}>{STATUS_LABEL[stop.status]}</Badge>}</td>,
          quantity: <td className={TD_NUM}>{stop.quantity}</td>,
          trail: <td className={TD_NUM}>{trailLabel(stop.trail, money)}</td>,
          high: <td className={TD_NUM}>{money(stop.high)}</td>,
          trigger: <td className={TD_NUM}>{watching ? money(triggerPrice(stop.high, stop.trail)) : "—"}</td>,
          now: (
            <td className={TD_NUM}>
              {watching && stop.lastPrice !== null ? (
                <div className="grid justify-items-end gap-1">
                  {money(stop.lastPrice)}
                  <div className="w-16">
                    <ShareBar share={triggerMargin(stop.lastPrice, stop.high, stop.trail)} label="Distance left to the sell price" />
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
          <td colSpan={COLUMNS} className="h-auto! max-w-none! pt-0! pb-3! whitespace-normal! text-ink-muted">
            {stop.message}
          </td>
        </tr>
      )}
    </>
  );
}

/** The trailing stops the app watches itself, with a form to start one. */
export function TrailingStops({ common, onOpenSecurity }: { common: Common; onOpenSecurity: (security: { isin: string; name: string }) => void }) {
  const { invoke, portfolios, held, tradingEnabled } = common;
  const { stops, problem, reload } = useTrailingStops(invoke);
  const { order, layout } = useTableLayout("trailing-stops", COLUMN_IDS);
  const resized = resizedTable(layout.widths);
  const logos = useExtensionIsinLogos({ invoke, isins: stops.map((stop) => stop.isin), enabled: Boolean(extension.logos?.useIsinLogos) });
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
                  <Row
                    key={stop.id}
                    order={order}
                    stop={stop}
                    logo={logos.get(stop.isin.toUpperCase())}
                    tradingEnabled={tradingEnabled}
                    onOpen={() => onOpenSecurity({ isin: stop.isin, name: stop.name })}
                    onRemove={() => void remove(stop.id)}
                  />
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
          held={held}
          invoke={invoke}
          tradingEnabled={tradingEnabled}
          onClose={() => setAdding(false)}
          onAdded={() => void reload()}
        />
      )}
    </>
  );
}
