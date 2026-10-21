import { RectangleGroupIcon } from "@heroicons/react/24/outline";
import { useEffect, useMemo, useState } from "react";
import { useExtensionIsinLogos } from "./extensions";
import { EmptyState, Pagination, ShareBar, SortHeader } from "./controls";
import { summarizeHoldings } from "./holdings";
import { paginate } from "./paging";
import { nextSort, sortItems, type SortState } from "./sorting";
import type { SecurityGroup } from "./groups";
import { formatChange, formatMoney, formatNumber, groupHas, type OverviewData, type ScreenerRow } from "./screener";
import { formatPercent, pluralize } from "./format";
import { Card, CardGrid, cx, DescriptionList, DescriptionRow, EMPTY, NAME_COLUMN, RECORD_TABLE, SCROLL_X, SecurityCell, SignGlyph, signClass, TD_NUM, btn } from "./ui";
import type { Invoke } from "./tools";

export function OverviewPage({
  data,
  invoke,
  logosEnabled,
  totalCurrency,
  pageSize,
  overviewFailed,
  groups,
  portfolioRows,
  groupErrors,
  groupsOffered,
  onOpenGroup,
  onOpenGroups,
}: {
  data: OverviewData;
  invoke: Invoke;
  logosEnabled: boolean;
  pageSize: number;
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
  const [positionsPage, setPositionsPage] = useState(1);
  const [positionsSort, setPositionsSort] = useState<SortState>(null);
  useEffect(() => setPositionsPage(1), [pageSize]);
  const sortedPositions = useMemo(() => sortItems(holdings.positions, positionsSort, (position, key) => position[key as keyof typeof position]), [holdings.positions, positionsSort]);
  const positions = paginate(sortedPositions, positionsPage, pageSize);
  const positionLogos = useExtensionIsinLogos({ invoke, isins: positions.rows.map((position) => position.isin), enabled: logosEnabled });
  const sortPositions = (column: string) => {
    setPositionsSort((current) => nextSort(current, column));
    setPositionsPage(1);
  };
  const holdingsMoney = (value: number) => formatMoney(value, holdings.currency);
  const holdingsSigned = (value: number) => `${value > 0 ? "+" : ""}${holdingsMoney(value)}`;
  const groupedTotal = groups.reduce((sum, group) => {
    const members = portfolioRows.filter((row) => groupHas(group, row));
    const fallback = members.some((row) => row.value !== null) ? members.reduce((total, row) => total + (row.value ?? 0), 0) : 0;
    return sum + (group.valuation ?? fallback);
  }, 0);

  return (
    <CardGrid label="Overview">
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
      {holdings.count > 0 && (
        <Card title="Positions" hint={positionsSort === null ? "largest first" : undefined} wide>
          <div className={SCROLL_X}>
            <table className={RECORD_TABLE}>
              <thead>
                <tr>
                  <SortHeader label="ISIN / name" column="name" sort={positionsSort} onSort={sortPositions} className={NAME_COLUMN} />
                  <SortHeader numeric label="Quantity" column="quantity" sort={positionsSort} onSort={sortPositions} />
                  <SortHeader numeric label="Avg price" column="avgPrice" sort={positionsSort} onSort={sortPositions} />
                  <SortHeader numeric label="Price" column="price" sort={positionsSort} onSort={sortPositions} />
                  <SortHeader numeric label="Cost" column="cost" sort={positionsSort} onSort={sortPositions} />
                  <SortHeader numeric label="Value" column="value" sort={positionsSort} onSort={sortPositions} />
                  <SortHeader numeric label="Share" column="weight" sort={positionsSort} onSort={sortPositions} />
                  <SortHeader numeric label="Price change today" column="today" sort={positionsSort} onSort={sortPositions} />
                  <SortHeader numeric label="Since buy" column="gain" sort={positionsSort} onSort={sortPositions} />
                </tr>
              </thead>
              <tbody>
                {positions.rows.map((position) => (
                  <tr key={position.rowId}>
                    <td>
                      <SecurityCell
                        initials={(position.name || position.isin).slice(0, 2).toUpperCase()}
                        logo={positionLogos.get(position.isin.toUpperCase())}
                        title={position.isin || position.name}
                        subtitle={position.isin ? position.name : undefined}
                      />
                    </td>
                    <td className={TD_NUM}>{position.quantity === null ? "—" : formatNumber(position.quantity, 0)}</td>
                    <td className={TD_NUM}>{position.avgPrice === null ? "—" : holdingsMoney(position.avgPrice)}</td>
                    <td className={TD_NUM}>{position.lastPrice === null ? "—" : holdingsMoney(position.lastPrice)}</td>
                    <td className={TD_NUM}>{position.cost === null ? "—" : holdingsMoney(position.cost)}</td>
                    <td className={TD_NUM}>{holdingsMoney(position.value)}</td>
                    <td className={TD_NUM}>{`${formatNumber(position.weight * 100, 1, 1)}%`}</td>
                    <td className={cx(TD_NUM, signClass(position.today))}>
                      <SignGlyph value={position.today} />
                      {position.today === null ? "—" : holdingsSigned(position.today)}
                    </td>
                    <td className={cx(TD_NUM, signClass(position.gain))}>
                      <SignGlyph value={position.gain} />
                      {position.gain === null ? "—" : `${holdingsSigned(position.gain)}${position.gainFraction !== null ? ` (${formatChange(position.gainFraction * 100)})` : ""}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="-mx-[1.2rem] -mb-4 mt-3">
            <Pagination page={positions.page} pageCount={positions.pageCount} total={holdings.positions.length} pageSize={positions.size} onPage={setPositionsPage} />
          </div>
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
