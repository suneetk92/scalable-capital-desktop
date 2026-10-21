import type { ToolActions } from "./toolActions";
import type { Invoke, ToolDef } from "./tools";

export type PagePortfolio = { portfolioId: string; name: string };

/** Everything a page needs to call Scalable's tools; built once in `App.tsx`. */
export type Common = {
  invoke: Invoke;
  defs: ToolDef[];
  portfolios: PagePortfolio[];
  actions: ToolActions;
  tradingEnabled: boolean;
  /** The "Rows per page" setting; 0 shows every row. */
  pageSize: number;
  reloadKey: unknown;
};

export type Connection = { state: "checking" | "connected" | "error"; detail?: string };

export function isRateLimited(connection: Connection) {
  return connection.state === "error" && /\b429\b/.test(connection.detail ?? "");
}

export type PortfolioSnapshot = {
  portfolioId: string;
  name: string;
  portfolio: unknown;
  holdings: unknown;
  overview?: unknown;
  overviewError?: string | null;
  cash?: unknown;
  cashError?: string | null;
};

export type Dashboard = {
  authenticated: boolean;
  portfolios: PortfolioSnapshot[];
  watchlist: unknown;
  watchlistError?: string | null;
  quotes?: Record<string, unknown>;
  groups?: Record<string, unknown>;
  tools?: string[];
  toolDefs?: ToolDef[];
};
