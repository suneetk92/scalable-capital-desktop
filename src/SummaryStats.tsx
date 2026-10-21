import { ArrowTrendingDownIcon, ArrowTrendingUpIcon, ChartBarSquareIcon, StarIcon, TableCellsIcon } from "@heroicons/react/24/outline";
import { pluralize } from "./format";
import { formatMoney, formatNumber } from "./screener";
import { Stat, StatGrid } from "./ui";

export function SummaryStats({
  hasPortfolioValue,
  portfolioTotal,
  totalCurrency,
  portfolioCount,
  todayReturn,
  positions,
  watchlistUnknown,
  watchlistCount,
}: {
  hasPortfolioValue: boolean;
  portfolioTotal: number;
  totalCurrency: string;
  portfolioCount: number;
  todayReturn: number | null;
  positions: number;
  watchlistUnknown: boolean;
  watchlistCount: number;
}) {
  return (
    <StatGrid label="Account summary">
      <Stat
        icon={ChartBarSquareIcon}
        label="Portfolio value"
        value={hasPortfolioValue ? formatMoney(portfolioTotal, totalCurrency) : "—"}
        foot={<>Across {pluralize(portfolioCount, "portfolio")}</>}
      />
      <Stat
        icon={todayReturn !== null && todayReturn < 0 ? ArrowTrendingDownIcon : ArrowTrendingUpIcon}
        label="Price change today"
        tone={todayReturn === null || todayReturn === 0 ? undefined : todayReturn > 0 ? "up" : "down"}
        value={todayReturn === null ? "—" : `${todayReturn > 0 ? "+" : ""}${formatMoney(todayReturn, totalCurrency)}`}
        foot="Absolute return today"
      />
      <Stat icon={TableCellsIcon} label="Positions" value={formatNumber(positions, 0)} foot="Held across your account" />
      <Stat icon={StarIcon} label="Watchlist" value={watchlistUnknown ? "—" : formatNumber(watchlistCount, 0)} foot={watchlistUnknown ? "Could not be loaded" : "Ideas you’re keeping an eye on"} />
    </StatGrid>
  );
}
