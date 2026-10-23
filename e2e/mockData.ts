import toolList from "../tests/fixtures/mcp-tool-list.json" with { type: "json" };

/** Made-up securities: [isin, name, price, bid, ask, intraday performance (fraction), quantity]. */
const SECURITIES: [string, string, number, number, number, number, number][] = [
  ["DE0007030009", "Rheinmetall", 1020.4, 1020.0, 1020.8, 0.0062, 3],
  ["DE0007100000", "Mercedes-Benz Group", 41.5, 41.48, 41.52, 0.0046, 40],
  ["DE000ENER6Y0", "Siemens Energy", 121.44, 121.42, 121.46, 0.0026, 12],
  ["KYG6427A1022", "NetEase", 20.9, 20.74, 21.07, -0.0122, 100],
  ["US0378331005", "Apple", 310.63, 310.55, 310.7, 0.001, 6],
  ["US03831W1080", "AppLovin Corp A", 235.23, 234.75, 235.7, 0.0036, 4],
  ["US0527691069", "Autodesk", 225.2, 223.55, 226.85, -0.0069, 5],
  ["XS3306516876", "WisdomTree Silver 3x Daily Leveraged", 4.13, 4.12, 4.13, -0.0256, 500],
];

const WATCHED: [string, string, number][] = Array.from({ length: 25 }, (_, index) => [`DE00052${String(index).padStart(5, "0")}`, `Watched company ${index + 1}`, 20 + index * 7.31]);

const quote = (price: number, bid: number, ask: number, performance: number) => ({
  midPrice: price,
  bidPrice: bid,
  askPrice: ask,
  performance: [{ timeframe: "INTRADAY", performance }],
});

const quotes: Record<string, unknown> = {};
for (const [isin, , price, bid, ask, performance] of SECURITIES) quotes[isin] = quote(price, bid, ask, performance);
for (const [isin, , price] of WATCHED) quotes[isin] = quote(price, price - 0.02, price + 0.03, (price % 7) / 100 - 0.03);

const holdings = SECURITIES.map(([isin, name, price, , , , quantity]) => ({
  isin,
  name,
  currentQuote: { midPrice: price },
  position: { filled: quantity },
  buyInValue: price * quantity * 0.9,
}));

export const dashboard = {
  authenticated: true,
  portfolios: [{ portfolioId: "p1", name: "Main portfolio", portfolio: { id: "p1", name: "Main portfolio", currency: "EUR" }, holdings, overview: null, overviewError: null, cash: null, cashError: null }],
  watchlist: { items: WATCHED.map(([isin, name]) => ({ isin, name })) },
  watchlistError: null,
  quotes,
  groups: {
    "list_portfolio_groups:p1": {
      portfolioId: "p1",
      canCreateAdditionalGroup: true,
      items: [{ name: "Leverage", groupId: "g1", holdings: [{ isin: "XS3306516876" }] }],
      ungroupedHoldings: SECURITIES.filter(([isin]) => isin !== "XS3306516876").map(([isin]) => ({ isin })),
    },
  },
  tools: toolList.result.tools.map((tool) => tool.name),
  toolDefs: toolList.result.tools,
};
