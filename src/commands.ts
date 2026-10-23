import type { Channel } from "@tauri-apps/api/core";
import type { BackgroundStatus } from "./hooks/useBackground";
import type { UpdateChannelSetting } from "./settings";
import type { SessionInfo } from "./session";
import type { Invoke, ToolOutcome } from "./tools";
import type { Dashboard } from "./types";
import type { UpdateProgress } from "./updates";

type LoginStatus = {
  status: "idle" | "pending" | "authenticated" | "failed";
  error?: string | null;
};

type ToolCall = { name: string; arguments: Record<string, unknown> };
type WatchlistReload = { watchlist: unknown; watchlistError?: string | null; quotes: Record<string, unknown> };
type Titled = { title: string; body: string };
export type PreviewResponse = { previewId: string; preview: unknown };

/** Every Tauri command registered in `src-tauri/src/lib.rs`, with its arguments (`undefined` when it takes none) and its result. */
type CommandMap = {
  begin_login: { args: undefined; result: string };
  login_status: { args: undefined; result: LoginStatus };
  logout: { args: undefined; result: void };
  get_access_token: { args: undefined; result: string };
  get_session_info: { args: undefined; result: SessionInfo };
  refresh_session: { args: undefined; result: SessionInfo };
  invalidate_session: { args: undefined; result: void };
  load_dashboard: { args: undefined; result: Dashboard };
  reload_groups: { args: { portfolioIds: string[] }; result: Record<string, unknown> };
  reload_watchlist: { args: { known: string[] }; result: WatchlistReload };
  load_tool_schemas: { args: undefined; result: unknown };
  call_tools: { args: { calls: ToolCall[] }; result: ToolOutcome[] };
  set_trading_enabled: { args: { enabled: boolean }; result: void };
  search_securities: { args: { query: string }; result: unknown };
  preview_order: { args: { request: object }; result: PreviewResponse };
  submit_order: { args: { previewId: string; request: object; acknowledgeWarning: boolean }; result: unknown };
  preview_savings_plan: { args: { request: object }; result: PreviewResponse };
  submit_savings_plan: { args: { previewId: string; request: object }; result: unknown };
  get_background: { args: undefined; result: BackgroundStatus };
  set_background: { args: BackgroundStatus; result: BackgroundStatus };
  show_notification: { args: Titled; result: void };
  check_for_update: { args: { channel: UpdateChannelSetting; reinstall?: boolean }; result: unknown };
  install_update: { args: { onProgress: Channel<UpdateProgress> }; result: void };
  export_diagnostics: { args: { updateChannel: UpdateChannelSetting }; result: string };
  open_log_folder: { args: undefined; result: void };
};

type Command = keyof CommandMap;

/** The same names as a runtime list (the compiler keeps it equal to `CommandMap`); a test checks it against `generate_handler!`. */
const REGISTRY: Record<Command, true> = {
  begin_login: true,
  login_status: true,
  logout: true,
  get_access_token: true,
  get_session_info: true,
  refresh_session: true,
  invalidate_session: true,
  load_dashboard: true,
  reload_groups: true,
  reload_watchlist: true,
  load_tool_schemas: true,
  call_tools: true,
  set_trading_enabled: true,
  search_securities: true,
  preview_order: true,
  submit_order: true,
  preview_savings_plan: true,
  submit_savings_plan: true,
  get_background: true,
  set_background: true,
  show_notification: true,
  check_for_update: true,
  install_update: true,
  export_diagnostics: true,
  open_log_folder: true,
};

export const COMMAND_NAMES = Object.keys(REGISTRY);

type ArgsOf<K extends Command> = CommandMap[K]["args"];
type CommandArgs<K extends Command> = ArgsOf<K> extends undefined ? [] : [args: ArgsOf<K>];

/** Calls a Tauri command through the injected `invoke`; the name, the arguments and the result are checked by the compiler. */
export function invokeCommand<K extends Command>(invoke: Invoke, name: K, ...args: CommandArgs<K>): Promise<CommandMap[K]["result"]> {
  return invoke<CommandMap[K]["result"]>(name, args[0] as Record<string, unknown> | undefined);
}

/** Scalable tools that more than one file refers to by name. */
export const TOOL = {
  ping: "ping",
  addPortfolioGroupHoldings: "add_portfolio_group_holdings",
  removePortfolioGroupHoldings: "remove_portfolio_group_holdings",
  addWatchlistItem: "add_watchlist_item",
  removeWatchlistItem: "remove_watchlist_item",
  cancelOrder: "cancel_order",
  createPortfolioGroup: "create_portfolio_group",
  createPriceAlert: "create_price_alert",
  getAccountProfile: "get_account_profile",
  getPortfolioGroup: "get_portfolio_group",
  getSavingsPlanConfig: "get_savings_plan_config",
  getSecurityChart: "get_security_chart",
  getSecurityNews: "get_security_news",
  getTransactionDetails: "get_transaction_details",
  listOrderVenues: "list_order_venues",
  listPortfolioTransactions: "list_portfolio_transactions",
  listPriceAlerts: "list_price_alerts",
  listSavingsPlans: "list_savings_plans",
} as const;
