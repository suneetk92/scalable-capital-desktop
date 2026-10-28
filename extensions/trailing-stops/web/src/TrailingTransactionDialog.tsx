import { DescriptionList, DescriptionRow, DialogFooter, ModalFrame, ModalHeader, btn } from "../../../../src/ui";
import { KeyValues } from "../../../../src/ToolViews";
import { formatDateTime, formatNumber } from "../../../../src/format";
import { formatMoney } from "../../../../src/screener";
import { trailLabel, triggerPrice, type TrailingStop } from "./trailing";

/** What the app did when a trailing stop fired: the rule, the price and what Scalable answered. */
export function TrailingTransactionDialog({ stop, onClose }: { stop: TrailingStop; onClose: () => void }) {
  const buying = stop.side === "buy";
  const verb = buying ? "Bought" : "Sold";
  return (
    <ModalFrame onClose={onClose}>
      <ModalHeader title={`${verb}: ${stop.name}`} closeLabel="Close details" onClose={onClose} />
      <p className="mb-3 text-ink-muted">{stop.isin}</p>
      <DescriptionList>
        <DescriptionRow label="When">{stop.executedAt === null ? "Not recorded" : formatDateTime(stop.executedAt * 1000)}</DescriptionRow>
        <DescriptionRow label={buying ? "Spent" : "Shares sold"}>{buying ? formatMoney(stop.amount ?? 0) : formatNumber(stop.quantity)}</DescriptionRow>
        <DescriptionRow label="Order type">Market</DescriptionRow>
        <DescriptionRow label={`${verb} at about`}>{stop.soldPrice === null ? "Not recorded" : formatMoney(stop.soldPrice)}</DescriptionRow>
        <DescriptionRow label="Distance">{trailLabel(stop.trail, formatMoney)}</DescriptionRow>
        <DescriptionRow label={buying ? "Lowest price seen" : "Highest price seen"}>{formatMoney(stop.high)}</DescriptionRow>
        <DescriptionRow label="Trigger price">{formatMoney(triggerPrice(stop.high, stop.trail, stop.side))}</DescriptionRow>
        <DescriptionRow label="Price when set">{formatMoney(stop.startPrice)}</DescriptionRow>
        {stop.lastPrice !== null && <DescriptionRow label="Last price checked">{formatMoney(stop.lastPrice)}</DescriptionRow>}
      </DescriptionList>
      {stop.receipt !== null && stop.receipt !== undefined && (
        <section className="mt-4">
          <h3 className="mb-1 font-semibold text-ink-heading">Scalable's answer</h3>
          <KeyValues value={stop.receipt} />
        </section>
      )}
      <DialogFooter className="mt-5">
        <button className={btn.primary} type="button" onClick={onClose}>
          Close
        </button>
      </DialogFooter>
    </ModalFrame>
  );
}
