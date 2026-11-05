import { DescriptionList, DescriptionRow, DialogFooter, ModalFrame, ModalHeader, btn } from "../../../../src/ui";
import { KeyValues } from "../../../../src/ToolViews";
import { formatDateTime, formatNumber } from "../../../../src/format";
import { formatMoney } from "../../../../src/screener";
import { executionPriceNote, isFilled, orderStateLabel, type OrderInfo } from "./orderState";
import { trailLabel, triggerPrice, type TrailingStop } from "./trailing";

/** What the app did when a trailing stop fired: the rule, the price and what Scalable answered. */
export function TrailingTransactionDialog({ stop, order, onClose }: { stop: TrailingStop; order?: OrderInfo; onClose: () => void }) {
  const buying = stop.side === "buy";
  const filled = isFilled(order);
  const verb = buying ? (filled ? "Bought" : "Buy order placed") : filled ? "Sold" : "Sell order placed";
  const executionNote = executionPriceNote(order);
  return (
    <ModalFrame onClose={onClose}>
      <ModalHeader title={`${verb}: ${stop.name}`} closeLabel="Close details" onClose={onClose} />
      <p className="mb-3 text-ink-muted">{stop.isin}</p>
      <DescriptionList>
        <DescriptionRow label="Order placed">{stop.executedAt === null ? "Not recorded" : formatDateTime(stop.executedAt * 1000)}</DescriptionRow>
        <DescriptionRow label="Execution time">{order?.executionTime ? formatDateTime(order.executionTime) : "Not reported"}</DescriptionRow>
        <DescriptionRow label="Execution price">
          {order?.executionPrice == null ? "Not reported" : <span title={executionNote ?? undefined}>{formatMoney(order.executionPrice, order.currency ?? "EUR")}</span>}
        </DescriptionRow>
        <DescriptionRow label={buying ? (stop.amount === null ? "Shares bought" : "Spent") : "Shares sold"}>
          {buying ? (stop.amount === null ? formatNumber(stop.quantity) : formatMoney(stop.amount)) : formatNumber(stop.quantity)}
        </DescriptionRow>
        {order && <DescriptionRow label="Order status">{orderStateLabel(order.state)}</DescriptionRow>}
        <DescriptionRow label="Order type">Market</DescriptionRow>
        <DescriptionRow label="Quote when placed">{stop.quotePrice === null ? "Not recorded" : formatMoney(stop.quotePrice)}</DescriptionRow>
        <DescriptionRow label="Distance">{trailLabel(stop.trail, formatMoney)}</DescriptionRow>
        <DescriptionRow label={buying ? "Lowest price" : "Highest price"}>{formatMoney(stop.high)}</DescriptionRow>
        <DescriptionRow label={buying ? "Buys at or above" : "Sells at or below"}>{formatMoney(triggerPrice(stop.high, stop.trail, stop.side))}</DescriptionRow>
        <DescriptionRow label="Price when set">{formatMoney(stop.startPrice)}</DescriptionRow>
        {stop.lastPrice !== null && <DescriptionRow label="Last price checked">{formatMoney(stop.lastPrice)}</DescriptionRow>}
      </DescriptionList>
      {order && order.history.length > 0 ? (
        <section className="mt-4">
          <h3 className="mb-1 font-semibold text-ink-heading">Order history at Scalable</h3>
          <DescriptionList>
            {order.history.map((step, index) => (
              <DescriptionRow key={`${step.state}-${step.timestamp}-${index}`} label={orderStateLabel(step.state)}>
                {formatDateTime(step.timestamp)}
              </DescriptionRow>
            ))}
          </DescriptionList>
        </section>
      ) : (
        stop.receipt !== null &&
        stop.receipt !== undefined && (
          <section className="mt-4">
            <h3 className="mb-1 font-semibold text-ink-heading">Scalable's answer when the order was placed</h3>
            <KeyValues value={stop.receipt} />
          </section>
        )
      )}
      <DialogFooter className="mt-5">
        <button className={btn.secondary} type="button" onClick={onClose}>
          Close
        </button>
      </DialogFooter>
    </ModalFrame>
  );
}
