import { NewspaperIcon } from "@heroicons/react/24/outline";
import { formatPercent } from "./format";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo, useState, type ReactNode } from "react";
import { EmptyState, Feed, SkeletonRows } from "./controls";
import { extension, type ExtensionContext } from "./extensions";
import type { Common } from "./types";
import { useToolQuery } from "./toolActions";
import { useShowDiagnostics } from "./settings";
import { Alert, btn, cx, DescriptionList, DescriptionRow, Drawer, EMPTY, Pills, RECORD_TABLE, SignGlyph, signClass, TD_NUM, TH_NUM } from "./ui";
import { LineChart } from "./LineChart";
import { JsonView, RecordTable } from "./ToolViews";
import { extractSeries, formatCell, humanize, sortByTimeframe, TIMEFRAMES } from "./tools";
import { findRecords, isRec, parseMaybeJson, pick, pickString, recordsOf, type Rec } from "./response";
import { TOOL } from "./commands";

export type DrawerTarget = {
  isin: string;
  name: string;
  symbol: string;
  currency: string;
  lastPrice: number | null;
  change: number | null;
  portfolioId: string;
  quantity: number | null;
  /** `null` when the watchlist could not be loaded, so the state is unknown. */
  inWatchlist: boolean | null;
};

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-t border-line py-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2.5 flex items-baseline justify-between gap-3 font-semibold tracking-wider text-ink-muted uppercase">{title}</h3>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">{children}</div>
    </section>
  );
}

function findPerformances(value: unknown, depth = 0): Rec[] {
  const parsed = parseMaybeJson(value);
  if (depth > 5 || parsed === null || parsed === undefined) return [];
  if (Array.isArray(parsed)) return parsed.flatMap((item) => findPerformances(item, depth + 1));
  if (!isRec(parsed)) return [];
  const direct = pick(parsed, ["performances"]);
  if (Array.isArray(direct)) return recordsOf(direct);
  for (const child of Object.values(parsed)) {
    const nested = findPerformances(child, depth + 1);
    if (nested.length > 0) return nested;
  }
  return [];
}

function findField(value: unknown, names: string[], depth = 0): unknown {
  const parsed = parseMaybeJson(value);
  if (depth > 5 || !isRec(parsed)) return undefined;
  const direct = pick(parsed, names);
  if (direct !== undefined && typeof direct !== "object") return direct;
  for (const child of Object.values(parsed)) {
    const nested = findField(child, names, depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function SecurityDrawer({
  target,
  quote,
  common,
  onClose,
  onTrade,
  formatMoney,
  extensionContext,
}: {
  target: DrawerTarget;
  quote: unknown;
  common: Common;
  onClose: () => void;
  onTrade: (side: "buy" | "sell") => void;
  formatMoney: (value: number | null, currency?: string) => string;
  extensionContext: ExtensionContext;
}) {
  const { actions, invoke, defs, reloadKey } = common;
  const showDiagnostics = useShowDiagnostics();
  const [timeframe, setTimeframe] = useState("one_month");
  const base = { isin: target.isin, portfolioId: target.portfolioId || common.portfolios[0]?.portfolioId };
  const chart = useToolQuery(invoke, defs, TOOL.getSecurityChart, actions.has(TOOL.getSecurityChart) ? [{ ...base, timeframe }] : null, reloadKey);
  const news = useToolQuery(invoke, defs, TOOL.getSecurityNews, actions.has(TOOL.getSecurityNews) ? [base] : null, reloadKey);
  const venues = useToolQuery(invoke, defs, TOOL.listOrderVenues, actions.has(TOOL.listOrderVenues) ? [base] : null, reloadKey);
  const performances = useMemo(() => sortByTimeframe(findPerformances(quote)), [quote]);
  const bid = findField(quote, ["bidPrice"]);
  const ask = findField(quote, ["askPrice"]);
  const chartOutcome = chart.entries[0]?.outcome;
  const points = chartOutcome?.ok ? extractSeries(chartOutcome.result) : [];
  const newsOutcome = news.entries[0]?.outcome;
  const venuesOutcome = venues.entries[0]?.outcome;
  const footer = (
    <>
      {target.inWatchlist === null ? (
        <small className="text-ink-muted">Watchlist status unknown. Refresh to check.</small>
      ) : target.inWatchlist ? (
        actions.has(TOOL.removeWatchlistItem) && (
          <button
            className={btn.secondary}
            type="button"
            onClick={() =>
              void actions.run(TOOL.removeWatchlistItem, { isin: target.isin }, { done: `${target.name} removed from your watchlist` }).then((outcome) => {
                if (outcome?.ok) onClose();
              })
            }
          >
            Remove from watchlist
          </button>
        )
      ) : target.quantity !== null && target.quantity > 0 ? (
        <small className="text-ink-muted" title="Scalable does not add held securities to the watchlist">
          In portfolio
        </small>
      ) : (
        actions.has(TOOL.addWatchlistItem) && (
          <button className={btn.secondary} type="button" onClick={() => void actions.run(TOOL.addWatchlistItem, { isin: target.isin }, { done: `${target.name} added to your watchlist` })}>
            Add to watchlist
          </button>
        )
      )}
      {actions.has(TOOL.createPriceAlert) && (
        <button className={btn.secondary} type="button" onClick={() => actions.openRunner(TOOL.createPriceAlert, { isin: target.isin, portfolioId: base.portfolioId })}>
          Price alert
        </button>
      )}
      {common.tradingEnabled && (
        <button className={`${btn.buy} h-[2.2rem]`} type="button" onClick={() => onTrade("buy")}>
          Buy
        </button>
      )}
      {common.tradingEnabled && target.quantity !== null && target.quantity > 0 && (
        <button className={`${btn.sell} h-[2.2rem]`} type="button" onClick={() => onTrade("sell")}>
          Sell
        </button>
      )}
    </>
  );

  return (
    <Drawer
      title={target.name}
      onClose={onClose}
      subtitle={
        <>
          <code>{target.isin}</code>
          {target.lastPrice !== null && (
            <>
              {" "}
              · <strong>{formatMoney(target.lastPrice, target.currency)}</strong>
            </>
          )}
          {target.change !== null && (
            <span className={signClass(target.change)}>
              {" "}
              <SignGlyph value={target.change} />
              {formatPercent(target.change, 2, 2)}
            </span>
          )}
          {target.quantity !== null && <> · {formatCell(target.quantity)} held</>}
        </>
      }
      footer={footer}
    >
      {extension.securityPanel?.top && <extension.securityPanel.top {...extensionContext} target={target} />}

      {actions.has(TOOL.getSecurityNews) && (
        <PanelSection title="News">
          {news.loading && !newsOutcome && <SkeletonRows rows={4} columns={2} label="Loading news…" />}
          {newsOutcome && !newsOutcome.ok && <Alert>{newsOutcome.error}</Alert>}
          {newsOutcome?.ok &&
            (() => {
              const items = findRecords(newsOutcome.result);
              const summary = pickString(pick(newsOutcome.result, ["summary"]), ["short"]);
              return items.length === 0 && !summary ? (
                <EmptyState icon={NewspaperIcon} title="No news" text="Scalable has no news for this security right now." />
              ) : (
                <>
                  {summary && <p className="rounded-panel bg-raised p-3 text-sm text-ink-muted">{summary}</p>}
                  <Feed
                    label="News"
                    items={items.slice(0, 20).map((item, index) => {
                      const url = pickString(item, ["url", "link", "href"]);
                      const title = pickString(item, ["title", "headline", "name", "summary"]) ?? "Untitled";
                      const meta = [pickString(item, ["sourceName", "source", "publisher"]), formatCell(pick(item, ["publicationTimeUtc", "publishedAt", "date", "timestamp", "timestampUtc", "time"]))]
                        .filter((part) => part && part !== "—")
                        .join(" · ");
                      return {
                        id: String(index),
                        icon: NewspaperIcon,
                        title: url ? (
                          <button
                            className={cx(btn.link, "text-left")}
                            type="button"
                            onClick={() => void openUrl(url).catch((error: unknown) => actions.notify({ kind: "error", text: String(error) }))}
                          >
                            {title}
                          </button>
                        ) : (
                          title
                        ),
                        meta: meta || undefined,
                      };
                    })}
                  />
                </>
              );
            })()}
          {newsOutcome?.ok && <JsonView value={newsOutcome.result} />}
        </PanelSection>
      )}

      {actions.has(TOOL.getSecurityChart) && (
        <PanelSection title="Chart">
          <div className="flex">
            <Pills label="Chart range" value={timeframe} options={TIMEFRAMES.map(([key, label]) => [key, label] as [string, string])} onSelect={setTimeframe} />
          </div>
          {chart.loading && <SkeletonRows rows={2} columns={2} label="Loading chart…" />}
          {chartOutcome && !chartOutcome.ok && <Alert>{chartOutcome.error}</Alert>}
          {chartOutcome?.ok &&
            (points.length >= 2 ? (
              <LineChart points={points} label="Price chart" />
            ) : (
              <p className={EMPTY}>
                The chart data has a format this app does not draw yet. {showDiagnostics ? " The raw data is below." : " Turn on Data diagnostics in Settings to see the raw data."}
              </p>
            ))}
          {chartOutcome?.ok && <JsonView value={chartOutcome.result} />}
        </PanelSection>
      )}

      {extension.securityPanel?.afterChart && <extension.securityPanel.afterChart {...extensionContext} target={target} />}

      <PanelSection title="Overview">
        {(bid !== undefined || ask !== undefined) && (
          <DescriptionList>
            {bid !== undefined && <DescriptionRow label="Bid">{formatCell(bid)}</DescriptionRow>}
            {ask !== undefined && <DescriptionRow label="Ask">{formatCell(ask)}</DescriptionRow>}
          </DescriptionList>
        )}
        {performances.length > 0 ? (
          <table className={RECORD_TABLE}>
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col" className={TH_NUM}>
                  Return
                </th>
                <th scope="col" className={TH_NUM}>
                  Absolute
                </th>
              </tr>
            </thead>
            <tbody>
              {performances.map((entry, index) => {
                const percent = pick(entry, ["performance"]);
                const absolute = pick(entry, ["simpleAbsoluteReturn"]);
                const value = typeof percent === "number" ? percent * 100 : null;
                return (
                  <tr key={index}>
                    <td>{humanize(String(pick(entry, ["timeframe"]) ?? ""))}</td>
                    <td className={`${TD_NUM} ${signClass(value)}`}>
                      <SignGlyph value={value} />
                      {formatPercent(value, 2, 2)}
                    </td>
                    <td className={TD_NUM}>{typeof absolute === "number" ? formatMoney(absolute, target.currency) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className={EMPTY}>No performance figures came with this quote.</p>
        )}
      </PanelSection>

      {actions.has(TOOL.listOrderVenues) && (
        <PanelSection title="Venues">
          {venues.loading && !venuesOutcome && <SkeletonRows rows={3} columns={3} label="Loading trading venues…" />}
          {venuesOutcome && !venuesOutcome.ok && <Alert>{venuesOutcome.error}</Alert>}
          {venuesOutcome?.ok && <RecordTable records={findRecords(venuesOutcome.result)} empty="No trading venues were returned." />}
          {venuesOutcome?.ok && <JsonView value={venuesOutcome.result} />}
        </PanelSection>
      )}

      {extension.securityPanel?.end && <extension.securityPanel.end {...extensionContext} target={target} />}
    </Drawer>
  );
}
