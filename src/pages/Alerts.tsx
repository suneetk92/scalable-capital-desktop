import { BellAlertIcon } from "@heroicons/react/24/outline";
import { useDeferredValue, useMemo, useState, type Ref } from "react";
import { useToolQuery } from "../toolActions";
import { type Common } from "../types";
import { btn, PanelFooter } from "../ui";
import { FILTER_TITLE, FiltersPopover, RadioList, SearchBox } from "../controls";
import { RecordTable } from "../ToolViews";
import { alertRemovedNotice } from "../notifications";
import { isAlertFiltering, matchesAlert, NO_ALERT_FILTER, parseAlerts, type AlertFilter } from "../alerts";
import { pickString, type Rec } from "../response";
import { QueryPanel, collect, perPortfolio, Section } from "./shared";
import { pluralize } from "../format";
import { TOOL } from "../commands";

const ALERT_ID_KEYS = ["alertId", "priceAlertId", "id"];

/** Names the removed alert by its security and price, for the notification center. */
function removedNotice(record: Rec) {
  const [alert] = parseAlerts([{ ...record, id: pickString(record, ALERT_ID_KEYS) ?? "alert" }]);
  return alertRemovedNotice({ name: alert?.name, price: alert?.targetPrice, direction: alert?.direction });
}

export function AlertsPage({ common, searchInput, onOpenSecurity }: { common: Common; searchInput?: Ref<HTMLInputElement>; onOpenSecurity: (security: { isin: string; name: string }) => void }) {
  const { actions, portfolios } = common;
  const query = useToolQuery(common.invoke, common.defs, TOOL.listPriceAlerts, actions.has(TOOL.listPriceAlerts) ? perPortfolio(portfolios) : null, common.reloadKey);
  const { records, portfolioOf } = useMemo(() => collect(query.entries), [query.entries]);
  const [filter, setFilter] = useState<AlertFilter>(NO_ALERT_FILTER);
  const shownFilter = useDeferredValue(filter);
  const filtering = isAlertFiltering(shownFilter);
  const visible = useMemo(() => (filtering ? records.filter((record) => matchesAlert(record, shownFilter)) : records), [filtering, records, shownFilter]);
  const activeFilters = (filter.direction !== "" ? 1 : 0) + (filter.status !== "" ? 1 : 0);
  const change = (next: Partial<AlertFilter>) => setFilter((current) => ({ ...current, ...next }));
  return (
    <>
      <Section
        title="Price alerts"
        flush
        footer={<PanelFooter tradingEnabled={common.tradingEnabled} />}
        hint={filtering ? `${pluralize(visible.length, "alert")} match${records.length !== visible.length ? ` (of ${records.length})` : ""}` : pluralize(records.length, "alert")}
        toolbar={
          <div className="flex min-h-[3.6667rem] items-center justify-end gap-3.5 border-b border-line px-4 max-[900px]:flex-col max-[900px]:items-start">
            <div className="flex items-center gap-2 max-[900px]:w-full max-[900px]:pb-2.5" role="search" aria-label="Filter price alerts">
              <SearchBox
                inputRef={searchInput}
                value={filter.text}
                onChange={(text) => change({ text })}
                placeholder="Search symbol or name"
                label="Search price alerts by symbol or name"
                shortcut={searchInput !== undefined}
              />
              <FiltersPopover count={activeFilters} onClear={() => change({ direction: "", status: "" })}>
                <div className={FILTER_TITLE}>Direction</div>
                <RadioList<AlertFilter["direction"]>
                  label="Direction"
                  value={filter.direction}
                  onChange={(direction) => change({ direction })}
                  options={[
                    ["", "All"],
                    ["up", "Rises to"],
                    ["down", "Falls to"],
                  ]}
                />
                <div className={FILTER_TITLE}>Status</div>
                <RadioList<AlertFilter["status"]>
                  label="Status"
                  value={filter.status}
                  onChange={(status) => change({ status })}
                  options={[
                    ["", "All"],
                    ["active", "Active"],
                    ["triggered", "Triggered"],
                  ]}
                />
              </FiltersPopover>
            </div>
          </div>
        }
      >
        <QueryPanel entries={query.entries} loading={query.loading} what="price alerts" />
        {query.entries.some((entry) => entry.outcome.ok) && (
          <RecordTable
            invoke={common.invoke}
            onOpenSecurity={onOpenSecurity}
            records={visible}
            pageSize={common.pageSize}
            emptyTitle={filtering && records.length > 0 ? "No matching alerts" : "No price alerts"}
            emptyIcon={BellAlertIcon}
            empty={
              filtering && records.length > 0
                ? "Try another search or clear the filters."
                : "Get notified when a security reaches a price. Create an alert with New alert at the top, or from a security’s details."
            }
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
    </>
  );
}
