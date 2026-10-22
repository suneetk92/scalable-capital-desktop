import { BellAlertIcon } from "@heroicons/react/24/outline";
import { useMemo } from "react";
import { useToolQuery } from "../toolActions";
import { type Common } from "../types";
import { btn, PanelFooter } from "../ui";
import { RecordTable } from "../ToolViews";
import { alertRemovedNotice } from "../notifications";
import { parseAlerts } from "../alerts";
import { pickString, type Rec } from "../response";
import { QueryPanel, collect, perPortfolio, Section } from "./shared";
import { TrailingStops } from "./TrailingStops";
import { pluralize } from "../format";
import { TOOL } from "../commands";

const ALERT_ID_KEYS = ["alertId", "priceAlertId", "id"];

/** Names the removed alert by its security and price, for the notification center. */
function removedNotice(record: Rec) {
  const [alert] = parseAlerts([{ ...record, id: pickString(record, ALERT_ID_KEYS) ?? "alert" }]);
  return alertRemovedNotice({ name: alert?.name, price: alert?.targetPrice, direction: alert?.direction });
}

export function AlertsPage({ common, onOpenSecurity }: { common: Common; onOpenSecurity: (security: { isin: string; name: string }) => void }) {
  const { actions, portfolios } = common;
  const query = useToolQuery(common.invoke, common.defs, TOOL.listPriceAlerts, actions.has(TOOL.listPriceAlerts) ? perPortfolio(portfolios) : null, common.reloadKey);
  const { records, portfolioOf } = useMemo(() => collect(query.entries), [query.entries]);
  return (
    <>
      <Section
        title="Price alerts"
        flush
        footer={<PanelFooter tradingEnabled={common.tradingEnabled} />}
        hint={pluralize(records.length, "alert")}
        actions={
          actions.has(TOOL.createPriceAlert) && (
            <button className={btn.primary} type="button" onClick={() => actions.openRunner(TOOL.createPriceAlert, { portfolioId: portfolios[0]?.portfolioId })}>
              New alert
            </button>
          )
        }
      >
        <QueryPanel entries={query.entries} loading={query.loading} what="price alerts" />
        {query.entries.some((entry) => entry.outcome.ok) && (
          <RecordTable
            invoke={common.invoke}
            onOpenSecurity={onOpenSecurity}
            records={records}
            pageSize={common.pageSize}
            emptyTitle="No price alerts"
            emptyIcon={BellAlertIcon}
            emptyAction={
              actions.has(TOOL.createPriceAlert) && (
                <button className={btn.primary} type="button" onClick={() => actions.openRunner(TOOL.createPriceAlert, { portfolioId: portfolios[0]?.portfolioId })}>
                  New alert
                </button>
              )
            }
            empty="Get notified when a security reaches a price. Create an alert here or from a security’s details."
            actions={
              actions.has("remove_price_alert")
                ? (record) => {
                    const alertId = pickString(record, ALERT_ID_KEYS);
                    return (
                      <button
                        className={btn.sell}
                        type="button"
                        onClick={() =>
                          void actions.run(
                            "remove_price_alert",
                            { portfolioId: portfolioOf.get(record), alertId, isin: pickString(record, ["isin"]) },
                            { confirm: "Remove this price alert?", confirmLabel: "Remove", done: removedNotice(record) },
                          )
                        }
                      >
                        Remove
                      </button>
                    );
                  }
                : undefined
            }
          />
        )}
      </Section>
      <TrailingStops common={common} onOpenSecurity={onOpenSecurity} />
    </>
  );
}
