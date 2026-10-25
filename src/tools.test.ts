import toolList from "../tests/fixtures/mcp-tool-list.json";
import { describe, expect, it } from "vite-plus/test";
import toolPolicy from "../tests/fixtures/tool-policy.json";
import trading from "../src-tauri/src/mcp/trading.rs?raw";
import {
  actionLabel,
  DIALOG_ONLY_TOOLS,
  buildArgs,
  coerce,
  exampleJson,
  extractSeries,
  formatPointTime,
  isManageTool,
  isReadTool,
  isTradingTool,
  isWriteTool,
  seriesTimes,
  sortByTimeframe,
  withoutRecords,
  type ToolDef,
} from "./tools";

const { trading: TRADING, manage: MANAGE, notTrading: NOT_TRADING } = toolPolicy as { trading: string[]; manage: string[]; notTrading: string[] };

describe("isTradingTool", () => {
  it.each(TRADING)("gates %s", (name) => expect(isTradingTool(name)).toBe(true));
  it.each(NOT_TRADING)("allows %s", (name) => expect(isTradingTool(name)).toBe(false));
});

describe("isManageTool", () => {
  it.each(MANAGE)("lets Restricted access run %s", (name) => {
    expect(isManageTool(name)).toBe(true);
    expect(isTradingTool(name)).toBe(false);
    expect(isWriteTool(name)).toBe(true);
  });
  it.each([...TRADING, ...NOT_TRADING])("does not count %s as a manage tool", (name) => expect(isManageTool(name)).toBe(false));
});

describe("read and write classification", () => {
  it.each(NOT_TRADING)("classifies %s as read-only", (name) => {
    expect(isReadTool(name)).toBe(true);
    expect(isWriteTool(name)).toBe(false);
  });
  it.each(TRADING)("fails closed for %s", (name) => {
    expect(isReadTool(name)).toBe(false);
    expect(isWriteTool(name)).toBe(true);
  });
});

/** The input schemas Scalable publishes, from the saved `tools/list` response (shared with the Rust tests). */
const schemas = Object.fromEntries(toolList.result.tools.map((t) => [t.name, t.inputSchema])) as unknown as Record<string, NonNullable<ToolDef["inputSchema"]>>;
const tool = (name: string): ToolDef => ({ name, inputSchema: schemas[name] });

describe("buildArgs", () => {
  it("coerces decimal input with either decimal separator", () => {
    expect(coerce({ type: "number" }, "1.234,56")).toBe(1234.56);
    expect(coerce({ type: "number" }, "1,234.56")).toBe(1234.56);
    expect(coerce({ type: "number" }, "not a number")).toBeUndefined();
  });
  it("builds the instrument object for create_price_alert", () => {
    const { args, missing } = buildArgs(tool("create_price_alert"), { isin: "XS3306516876", price: "12,5", portfolioId: "p-1" });
    expect(args).toEqual({ instrument: { kind: "security", isin: "XS3306516876" }, price: "12,5", portfolioId: "p-1" });
    expect(missing).toEqual([]);
  });

  it("reports required properties that could not be filled", () => {
    const { args, missing } = buildArgs(tool("create_price_alert"), { price: 10 });
    expect(args).toEqual({ price: 10 });
    expect(missing).toEqual(["instrument"]);
  });

  it("uses the schema's own property names and leaves out the ones a tool does not have", () => {
    const { args, missing } = buildArgs(tool("remove_price_alert"), { portfolioId: "p1", alertId: "a1", isin: "US0378331005", planId: "x", empty: "", gone: null });
    expect(args).toEqual({ portfolioId: "p1", alertId: "a1" });
    expect(missing).toEqual([]);
    expect(buildArgs(tool("get_security_chart"), { isin: "US0378331005", portfolioId: "p1", timeframe: "one_month" }).args).toEqual({ isin: "US0378331005", timeframe: "one_month" });
  });

  it("builds overnight transaction arguments from the published schema", () => {
    const { args, missing } = buildArgs(tool("list_overnight_transactions"), {
      pageSize: "50",
      transactionTypes: "interest",
      searchTerm: "interest",
      cursor: "next",
      savingsAccountId: "account-1",
      ignored: "not in the schema",
    });
    expect(args).toEqual({ pageSize: 50, transactionTypes: ["interest"], searchTerm: "interest", cursor: "next", savingsAccountId: "account-1" });
    expect(missing).toEqual([]);
  });

  it("checks enum values and converts types", () => {
    expect(buildArgs(tool("get_security_chart"), { isin: "US0378331005", timeframe: "1y" }).missing).toEqual(["timeframe"]);
    expect(buildArgs(tool("list_portfolio_transactions"), { pageSize: "50", cursor: "c" }).args).toEqual({ pageSize: 50, cursor: "c" });
    expect(buildArgs(tool("add_portfolio_group_holdings"), { groupId: "g", isins: "US0378331005" }).args).toEqual({ groupId: "g", isins: ["US0378331005"] });
  });

  it("fills required enum and default values only when asked to", () => {
    const chart = tool("get_security_chart");
    expect(buildArgs(chart, { isin: "US0378331005" }).missing).toEqual(["timeframe"]);
    expect(buildArgs(chart, { isin: "US0378331005" }, true).args).toEqual({ isin: "US0378331005", timeframe: "one_day" });
  });

  it("passes values through untouched when the tool has no schema", () => {
    expect(buildArgs(undefined, { isin: "X", empty: "" }).args).toEqual({ isin: "X" });
  });

  it("only sends properties every published tool really has", () => {
    const calls: [string, Record<string, unknown>][] = [
      ["add_watchlist_item", { isin: "US0378331005", portfolioId: "p" }],
      ["remove_watchlist_item", { isin: "US0378331005", portfolioId: "p" }],
      ["create_portfolio_group", { name: "n", description: "d", portfolioId: "p" }],
      ["upsert_portfolio_group", { groupId: "g", name: "n", description: "d", portfolioId: "p" }],
      ["remove_portfolio_group", { groupId: "g", portfolioId: "p" }],
      ["remove_portfolio_group_holdings", { groupId: "g", isins: ["US0378331005"], portfolioId: "p" }],
      ["remove_savings_plan", { isin: "US0378331005", portfolioId: "p" }],
      ["cancel_order", { orderId: "o", portfolioId: "p" }],
      ["list_price_alerts", { portfolioId: "p", activeOnly: false }],
      ["get_transaction_details", { transactionId: "t", portfolioId: "p" }],
      ["get_fixed_term_account", { fixedTermAccountId: "f" }],
      ["search_securities", { query: "apple", portfolioId: "p" }],
    ];
    for (const [name, semantic] of calls) {
      const { args, missing } = buildArgs(tool(name), semantic);
      expect(missing, name).toEqual([]);
      expect(Object.keys(args).sort(), name).toEqual(Object.keys(semantic).sort());
    }
  });
});

describe("sortByTimeframe", () => {
  const names = (list: { timeframe: string }[]) => sortByTimeframe(list).map((entry) => entry.timeframe);

  it("orders periods from the shortest to the longest", () => {
    const shuffled = ["intraday", "max", "one_month", "one_week", "one_year", "since_buy", "six_months", "three_months", "two_days", "year_to_date"];
    expect(names([...shuffled].sort().map((timeframe) => ({ timeframe })))).toEqual([
      "intraday",
      "two_days",
      "one_week",
      "one_month",
      "three_months",
      "six_months",
      "year_to_date",
      "one_year",
      "since_buy",
      "max",
    ]);
  });

  it("reads camelCase names and keeps unknown periods last, in their original order", () => {
    expect(names([{ timeframe: "zeta" }, { timeframe: "max" }, { timeframe: "alpha" }, { timeframe: "oneWeek" }])).toEqual(["oneWeek", "max", "zeta", "alpha"]);
  });
});

describe("chart series", () => {
  it("reads a price series from records", () => {
    const result = {
      series: [
        { date: "2026-01-02", close: 100 },
        { date: "2026-01-03", close: 104.5 },
      ],
    };
    expect(extractSeries(result)).toEqual([
      { label: "2026-01-02", value: 100 },
      { label: "2026-01-03", value: 104.5 },
    ]);
  });

  it("formats ISO dates and epoch times and keeps other labels", () => {
    expect(formatPointTime("2026-01-02")).toMatch(/2026/);
    expect(formatPointTime("2026-01-02T21:59:00Z")).toMatch(/2026/);
    expect(formatPointTime("1767391140")).toMatch(/2026/);
    expect(formatPointTime("1767391140000")).toMatch(/2026/);
    expect(formatPointTime("7")).toBe("7");
  });

  it("turns rising dates and epoch times into seconds", () => {
    const at = (...labels: string[]) => seriesTimes(labels.map((label) => ({ label, value: 1 })));
    expect(at("2026-01-02", "2026-01-03")).toEqual([Date.UTC(2026, 0, 2) / 1000, Date.UTC(2026, 0, 3) / 1000]);
    expect(at("2026-01-02T21:59:00Z", "2026-01-02T22:00:00Z")).toEqual([Date.UTC(2026, 0, 2, 21, 59) / 1000, Date.UTC(2026, 0, 2, 22) / 1000]);
    expect(at("1767391140", "1767391200000")).toEqual([1767391140, 1767391200]);
  });

  it("gives no times for indexes, repeated or falling times", () => {
    const at = (...labels: string[]) => seriesTimes(labels.map((label) => ({ label, value: 1 })));
    expect(at("1", "2", "3")).toBeNull();
    expect(at("2026-01-03", "2026-01-02")).toBeNull();
    expect(at("2026-01-02", "2026-01-02")).toBeNull();
    expect(at("2026-01-02", "later")).toBeNull();
  });
});

describe("actionLabel", () => {
  it("names the button after what the tool does", () => {
    expect(actionLabel("create_price_alert").label).toBe("Create");
    expect(actionLabel("add_watchlist_item").label).toBe("Add");
    expect(actionLabel("upsert_savings_plan").label).toBe("Save");
    expect(actionLabel("remove_savings_plan")).toMatchObject({ label: "Remove", destructive: true });
    expect(actionLabel("submit_buy_order").label).toBe("Submit buy order");
    expect(actionLabel("get_cash_overview")).toMatchObject({ label: "Run", busy: "Running…", destructive: false });
  });
});

describe("exampleJson", () => {
  it("gives the instrument shape the tool expects", () => {
    expect(JSON.parse(exampleJson("instrument", undefined))).toEqual({ kind: "security", isin: "US0378331005" });
  });

  it("builds other examples from the schema", () => {
    const prop = { type: "object", properties: { side: { enum: ["buy", "sell"] }, amount: { type: "number" }, tags: { type: "array", items: { type: "string" } } } };
    expect(JSON.parse(exampleJson("filter", prop))).toEqual({ side: "buy", amount: 1, tags: ["text"] });
  });
});

describe("tools that only their dialogs may submit", () => {
  it("are the same tools the backend refuses from the generic runner", () => {
    const list = /const BLOCKED_GENERIC_TOOLS: \[&str; \d+\] =\s*\[([^\]]*)\]/.exec(trading)?.[1] ?? "";
    const blocked = [...list.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]).sort();
    expect(blocked).toEqual(Object.keys(DIALOG_ONLY_TOOLS).sort());
    for (const name of blocked) expect(isTradingTool(name)).toBe(true);
  });
});

describe("withoutRecords", () => {
  const match = (record: Record<string, unknown>) => record.id === "a1";

  it("drops matching records from a list or from a list inside an object", () => {
    expect(withoutRecords([{ id: "a1" }, { id: "a2" }], match)).toEqual([{ id: "a2" }]);
    expect(withoutRecords({ alerts: [{ id: "a1" }, { id: "a2" }], total: 2 }, match)).toEqual({ alerts: [{ id: "a2" }], total: 2 });
  });

  it("reads a JSON string result", () => {
    expect(withoutRecords(JSON.stringify({ alerts: [{ id: "a1" }] }), match)).toEqual({ alerts: [] });
  });
});
