import { RectangleGroupIcon } from "@heroicons/react/24/outline";
import { useMemo } from "react";
import { EmptyState, ShareBar } from "./controls";
import { summarizeHoldings } from "./holdings";
import type { SecurityGroup } from "./groups";
import { formatChange, formatMoney, formatNumber, groupHas, type OverviewData, type ScreenerRow } from "./screener";
import { formatPercent, pluralize } from "./format";
import { Card, CardGrid, cx, DescriptionList, DescriptionRow, EMPTY, SignGlyph, signClass, btn } from "./ui";

export function OverviewPage({
  data,
  totalCurrency,
  overviewFailed,
  groups,
  portfolioRows,
  groupErrors,
  groupsOffered,
  onOpenGroup,
  onOpenGroups,
}: {
  data: OverviewData;
  totalCurrency: string;
  overviewFailed: boolean;
  groups: SecurityGroup[];
  portfolioRows: ScreenerRow[];
  groupErrors: string[];
  groupsOffered: boolean;
  onOpenGroup: (group: SecurityGroup) => void;
  onOpenGroups: () => void;
}) {
  const holdings = useMemo(() => summarizeHoldings(portfolioRows, totalCurrency), [portfolioRows, totalCurrency]);
  const holdingsHint = [
    holdings.withCost < holdings.count ? `cost known for ${holdings.withCost} of ${holdings.count}` : pluralize(holdings.count, "position"),
    holdings.mixedCurrencies ? "multiple currencies; totals are not converted" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const holdingsMoney = (value: number) => formatMoney(value, holdings.currency);
  const holdingsSigned = (value: number) => `${value > 0 ? "+" : ""}${holdingsMoney(value)}`;
  const groupedTotal = groups.reduce((sum, group) => {
    const members = portfolioRows.filter((row) => groupHas(group, row));
    const fallback = members.some((row) => row.value !== null) ? members.reduce((total, row) => total + (row.value ?? 0), 0) : 0;
    return sum + (group.valuation ?? fallback);
  }, 0);

  return (
    <CardGrid label="Overview" wide>
      <Card title="Returns" hint="Scalable figures">
        {data.performance.size > 0 ? (
          <DescriptionList>
            {[...data.performance].map(([label, value]) => (
              <DescriptionRow key={label} label={label} tone={value > 0 ? "up" : value < 0 ? "down" : undefined}>
                {value > 0 ? "+" : ""}
                {formatMoney(value, totalCurrency)}
              </DescriptionRow>
            ))}
          </DescriptionList>
        ) : (
          <p className={EMPTY}>{overviewFailed ? "The performance figures could not be loaded. See the notice above and try Refresh." : "Scalable did not return performance figures."}</p>
        )}
      </Card>
      <Card title="Cash and buying power">
        <DescriptionList>
          <DescriptionRow label="Securities">{formatMoney(data.securities, totalCurrency)}</DescriptionRow>
          <DescriptionRow label="Cash balance">{formatMoney(data.balance, totalCurrency)}</DescriptionRow>
          <DescriptionRow label="Buying power">{formatMoney(data.power, totalCurrency)}</DescriptionRow>
          <DescriptionRow label="Available credit line">{formatMoney(data.credit, totalCurrency)}</DescriptionRow>
        </DescriptionList>
      </Card>
      <Card title="Top movers" hint="today">
        {data.gainers.length + data.losers.length > 0 ? (
          <DescriptionList>
            {[...data.gainers, ...[...data.losers].reverse()].map((row) => (
              <DescriptionRow key={row.rowId} label={row.name !== row.symbol ? row.name : row.symbol} tone={(row.change ?? 0) > 0 ? "up" : "down"}>
                {formatChange(row.change)}
              </DescriptionRow>
            ))}
          </DescriptionList>
        ) : (
          <p className={EMPTY}>No holdings moved today.</p>
        )}
      </Card>
      {holdings.count > 0 && (
        <Card title="Holdings" hint={holdingsHint}>
          <DescriptionList>
            <DescriptionRow label="Market value">{holdingsMoney(holdings.value)}</DescriptionRow>
            <DescriptionRow label="Cost">{holdings.withCost > 0 ? holdingsMoney(holdings.cost) : "—"}</DescriptionRow>
            <DescriptionRow label="Gain since buy" tone={holdings.withCost === 0 || holdings.gain === 0 ? undefined : holdings.gain > 0 ? "up" : "down"}>
              {holdings.withCost > 0 ? `${holdingsSigned(holdings.gain)}${holdings.gainFraction !== null ? ` (${formatChange(holdings.gainFraction * 100)})` : ""}` : "—"}
            </DescriptionRow>
            <DescriptionRow label="Price change today" tone={holdings.today === 0 ? undefined : holdings.today > 0 ? "up" : "down"}>
              {`${holdingsSigned(holdings.today)}${holdings.todayFraction !== null ? ` (${formatChange(holdings.todayFraction * 100)})` : ""}`}
            </DescriptionRow>
            <DescriptionRow label="Top 5 positions">{`${formatNumber(holdings.topFiveShare * 100, 1, 1)}% of value`}</DescriptionRow>
            {holdings.best && <DescriptionRow label="Best position" tone="up">{`${holdings.best.name} ${formatChange((holdings.best.gainFraction ?? 0) * 100)}`}</DescriptionRow>}
            {holdings.worst && <DescriptionRow label="Worst position" tone="down">{`${holdings.worst.name} ${formatChange((holdings.worst.gainFraction ?? 0) * 100)}`}</DescriptionRow>}
          </DescriptionList>
        </Card>
      )}
      <Card title="Your Scalable groups" wide>
        {groups.length > 0 ? (
          <ul role="list" className="divide-y divide-ink-heading/10">
            {groups.map((group) => {
              const members = portfolioRows.filter((row) => groupHas(group, row));
              const total = members.some((row) => row.value !== null) ? members.reduce((sum, row) => sum + (row.value ?? 0), 0) : null;
              const value = group.valuation ?? total;
              return (
                <li key={group.id} className="grid gap-1.5 py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <div className="grid gap-0.5">
                      <button className={cx(btn.link, "justify-self-start")} type="button" onClick={() => onOpenGroup(group)}>
                        {group.name}
                      </button>
                      <small className="text-ink-muted">
                        {pluralize(group.holdings.length, "holding")}
                        {group.sinceBuyPerformance !== null && (
                          <span className={signClass(group.sinceBuyPerformance)}>
                            {" · "}
                            <SignGlyph value={group.sinceBuyPerformance} />
                            {`${formatPercent(group.sinceBuyPerformance * 100)} since buy`}
                          </span>
                        )}
                      </small>
                    </div>
                    <strong className="font-semibold tabular-nums text-ink-strong">
                      {formatMoney(value, group.valuation !== null ? group.currency : totalCurrency)}
                      {value !== null && groupedTotal > 0 && <span className="ml-2 font-normal text-ink-muted">{formatPercent((value / groupedTotal) * 100)}</span>}
                    </strong>
                  </div>
                  {value !== null && groupedTotal > 0 && <ShareBar share={value / groupedTotal} label={`${group.name} share of grouped value`} />}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={RectangleGroupIcon}
            title="No groups to show"
            text={
              !groupsOffered
                ? "Scalable’s connection does not offer a groups tool for this account, so your groups cannot be read yet. Sign out and in again after checking the MCP access level in the Scalable app."
                : groupErrors.length > 0
                  ? `Scalable’s groups tool failed: ${groupErrors[0]}`
                  : "You have no groups yet. Create one to bundle holdings."
            }
            action={
              groupErrors.length === 0 && (
                <button className={btn.secondary} type="button" onClick={onOpenGroups}>
                  Open groups
                </button>
              )
            }
          />
        )}
      </Card>
    </CardGrid>
  );
}
