// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { formatDateTime } from "../../../../src/format";
import { formatMoney } from "../../../../src/screener";
import { storageKey } from "../../../../src/storage";
import { clearToolQueryCache } from "../../../../src/toolActions";
import type { Invoke } from "../../../../src/tools";
import type { Common } from "../../../../src/types";
import { TrailingStops } from "./TrailingStops";
import { parseTrailingList } from "./trailing";
import type { useTrailingStops } from "./useTrailingStops";

afterEach(() => {
  cleanup();
  clearToolQueryCache();
  localStorage.clear();
});

const stored = {
  id: "sell",
  isin: "US0378331005",
  name: "Apple Inc.",
  side: "sell",
  shares: 2,
  trail: { kind: "percent", value: 5 },
  startPrice: 100,
  high: 100,
  lastPrice: 95,
  status: "sold",
  soldPrice: 94.5,
  executedAt: 1_700_000_000,
  receipt: { orderId: "sell-order" },
  createdAt: 1,
};

const buy = { ...stored, id: "buy", isin: "US5949181045", name: "Microsoft", side: "buy", shares: 0, amount: 250, soldPrice: 105.75, executedAt: 1_700_000_400, receipt: { orderId: "buy-order" } };
const buyShares = { ...buy, id: "buy-shares", name: "Nvidia", shares: 3, amount: undefined, receipt: undefined };

const details: Record<string, unknown> = {
  "sell-order": {
    transaction: {
      currency: "EUR",
      securityTrade: { status: "SETTLED", finalisationReason: "FILLED", averagePrice: "93.75" },
      history: [
        { state: "FILLED", timestamp: "2026-10-28T15:15:00Z", executionPrice: "93.75" },
        { state: "SETTLED", timestamp: "2026-10-29T06:00:00Z" },
      ],
    },
  },
  "buy-order": {
    transaction: {
      currency: "USD",
      securityTrade: { status: "SETTLED", finalisationReason: "FILLED", averagePrice: "106.25" },
      history: [{ state: "FILLED", timestamp: "2026-10-29T10:00:00Z", executionPrice: "106.25" }],
    },
  },
};

function renderStops(records: unknown[], responses = details, reloadKey = 0, failFirstQuery = false) {
  let firstFailed = false;
  const invoke = vi.fn(async <T = unknown,>(command: string, args?: Record<string, unknown>) => {
    if (command === "call_tools") {
      const calls = args?.calls as { name: string; arguments: Record<string, unknown> }[];
      if (failFirstQuery && !firstFailed) {
        firstFailed = true;
        return calls.map((call) => ({ name: call.name, ok: false, error: "offline" })) as T;
      }
      return calls.map((call) => ({ name: call.name, ok: true, result: responses[String(call.arguments.transactionId)] })) as T;
    }
    return undefined as T;
  }) as Invoke;
  const common: Common = {
    invoke,
    defs: [{ name: "get_transaction_details", inputSchema: { properties: { transactionId: { type: "string" }, portfolioId: { type: "string" } }, required: ["transactionId"] } }],
    portfolios: [],
    held: [],
    actions: { run: vi.fn(), openRunner: vi.fn(), notify: vi.fn(), has: (name) => name === "get_transaction_details" },
    tradingEnabled: true,
    manageEnabled: true,
    pageSize: 10,
    reloadKey,
  };
  const trailing: ReturnType<typeof useTrailingStops> = {
    ...parseTrailingList({ stops: records }),
    loaded: true,
    reload: vi.fn(async () => {}),
    checking: false,
    checkNow: vi.fn(async () => {}),
    checkError: null,
    setCheckError: vi.fn(),
    openedAt: 0,
  };
  const view = render(<TrailingStops common={common} trailing={trailing} onOpenSecurity={vi.fn()} />);
  return {
    ...view,
    invoke,
    refresh: (nextReloadKey: number) => view.rerender(<TrailingStops common={{ ...common, reloadKey: nextReloadKey }} trailing={trailing} onOpenSecurity={vi.fn()} />),
  };
}

function cell(table: HTMLElement, name: string, label: string) {
  const headers = within(table).getAllByRole("columnheader");
  const index = headers.findIndex((header) => header.textContent === label);
  expect(index).toBeGreaterThanOrEqual(0);
  const row = within(table).getByText(name).closest("tr");
  expect(row).not.toBeNull();
  return row!.querySelectorAll("td")[index];
}

describe("trailing stop tables", () => {
  it("shows Scalable's execution time and price for both sides, matching Details", async () => {
    renderStops([stored, buy]);
    const tables = screen.getAllByRole("table");
    for (const [table, stop, time, price, priceLabel] of [
      [tables[0], stored, "2026-10-28T15:15:00Z", 93.75, "Execution price"],
      [tables[1], buy, "2026-10-29T10:00:00Z", 106.25, "Execution price"],
    ] as const) {
      const formattedTime = formatDateTime(time);
      const formattedPrice = formatMoney(price, stop.side === "buy" ? "USD" : "EUR");
      await waitFor(() => expect(cell(table, stop.name, "Execution time").textContent).toBe(formattedTime));
      expect(cell(table, stop.name, priceLabel).textContent).toBe(formattedPrice);
      const row = within(table).getByText(stop.name).closest("tr")!;
      fireEvent.click(within(row).getByRole("button", { name: "Details" }));
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getAllByText(formattedTime).length).toBeGreaterThan(0);
      expect(within(dialog).getByText(formattedPrice)).toBeTruthy();
      expect(within(dialog).getByText("Order placed")).toBeTruthy();
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    }
    expect(JSON.parse(localStorage.getItem("scalable-capital-desktop.trailing-order-states") ?? "{}")).toMatchObject({
      sell: { executionPrice: 93.75, executionTime: "2026-10-28T15:15:00Z", currency: "EUR", executionChecked: true },
      buy: { executionPrice: 106.25, executionTime: "2026-10-29T10:00:00Z", currency: "USD", executionChecked: true },
    });
  });

  it("shows a share-based buy size in the table and transaction details", () => {
    renderStops([buyShares]);
    const table = screen.getByRole("table");
    expect(cell(table, "Nvidia", "Amount / shares").textContent).toBe("3 shares");
    fireEvent.click(within(within(table).getByText("Nvidia").closest("tr")!).getByRole("button", { name: "Details" }));
    expect(screen.getByText("Shares bought")).toBeTruthy();
    expect(screen.getByText("3", { selector: "dd" })).toBeTruthy();
  });

  it("shows dashes for active stops and independently missing Scalable execution fields", async () => {
    const active = { ...stored, id: "active", name: "Active", status: "active" };
    const legacy = { ...stored, id: "legacy", name: "Legacy", executedAt: undefined, soldPrice: undefined, receipt: { orderId: "legacy-order" } };
    const noPrice = { ...buy, id: "no-price", name: "No price", receipt: { orderId: "no-price-order" } };
    const noTime = { ...buy, id: "no-time", name: "No time", receipt: { orderId: "no-time-order" } };
    const noExecutionPrice: Record<string, unknown> = {
      ...details,
      "legacy-order": { transaction: { securityTrade: { status: "SETTLED" }, history: [{ state: "SETTLED", timestamp: "2026-10-30T06:00:00Z" }] } },
      "no-price-order": { transaction: { securityTrade: { status: "SETTLED" }, history: [{ state: "FILLED", timestamp: "2026-10-29T12:00:00Z" }] } },
      "no-time-order": { transaction: { currency: "EUR", securityTrade: { status: "SETTLED", averagePrice: "105.75" }, history: [] } },
    };
    renderStops([active, legacy, noPrice, noTime], noExecutionPrice);
    const [sellTable, buyTable] = screen.getAllByRole("table");
    for (const name of ["Active", "Legacy"]) {
      expect(cell(sellTable, name, "Execution time").textContent).toBe("—");
      expect(cell(sellTable, name, "Execution price").textContent).toBe("—");
    }
    await waitFor(() => expect(cell(buyTable, "No price", "Execution time").textContent).toBe(formatDateTime("2026-10-29T12:00:00Z")));
    expect(cell(buyTable, "No price", "Execution price").textContent).toBe("—");
    expect(cell(buyTable, "No time", "Execution time").textContent).toBe("—");
    expect(cell(buyTable, "No time", "Execution price").textContent).toBe(formatMoney(105.75, "EUR"));
  });

  it("fetches legacy finalized orders once to populate execution fields", async () => {
    const legacy = { ...stored, id: "legacy", name: "Legacy", receipt: { orderId: "legacy-order" } };
    localStorage.setItem("scalable-capital-desktop.trailing-order-states", JSON.stringify({ legacy: { state: "SETTLED", final: true, history: [] } }));
    const legacyDetails: Record<string, unknown> = {
      "legacy-order": { transaction: { securityTrade: { status: "SETTLED" }, history: [{ state: "SETTLED", timestamp: "2026-10-30T06:00:00Z" }] } },
    };
    const { invoke } = renderStops([legacy], legacyDetails);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("call_tools", expect.objectContaining({ calls: [expect.objectContaining({ name: "get_transaction_details" })] })));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("scalable-capital-desktop.trailing-order-states") ?? "{}").legacy.executionChecked).toBe(true));
    expect(cell(screen.getByRole("table"), "Legacy", "Execution price").textContent).toBe("—");
  });

  it("retries a failed legacy enrichment on refresh", async () => {
    const legacy = { ...stored, id: "legacy", name: "Legacy", receipt: { orderId: "legacy-order" } };
    localStorage.setItem("scalable-capital-desktop.trailing-order-states", JSON.stringify({ legacy: { state: "SETTLED", final: true, history: [] } }));
    const legacyDetails: Record<string, unknown> = {
      "legacy-order": { transaction: { currency: "EUR", securityTrade: { status: "SETTLED", averagePrice: "93.75" }, history: [{ state: "FILLED", timestamp: "2026-10-28T15:15:00Z" }] } },
    };
    const { invoke, refresh } = renderStops([legacy], legacyDetails, 0, true);

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(JSON.parse(localStorage.getItem("scalable-capital-desktop.trailing-order-states") ?? "{}").legacy.executionChecked).toBeUndefined();
    refresh(1);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("scalable-capital-desktop.trailing-order-states") ?? "{}").legacy.executionChecked).toBe(true));
    expect(cell(screen.getByRole("table"), "Legacy", "Execution price").textContent).toBe(formatMoney(93.75, "EUR"));
  });

  it("merges the columns into saved layouts without misaligning the values", async () => {
    const order = ["actions", "now", "status", "name", "quantity", "trail", "high", "trigger"];
    for (const name of ["trailing-stops", "trailing-buy-stops"]) {
      localStorage.setItem(storageKey(`table.${name}`), JSON.stringify({ order, widths: { now: 10, actions: 12 } }));
    }
    renderStops([stored, buy]);
    const tables = screen.getAllByRole("table");
    for (const [table, stop, time, price] of [
      [tables[0], stored, "2026-10-28T15:15:00Z", 93.75],
      [tables[1], buy, "2026-10-29T10:00:00Z", 106.25],
    ] as const) {
      expect(
        within(table)
          .getAllByRole("columnheader")
          .map((header) => header.getAttribute("data-col")),
      ).toEqual(["actions", "now", "placed", "atAbout", "status", "name", "quantity", "trail", "high", "trigger"]);
      await waitFor(() => expect(cell(table, stop.name, "Execution time").textContent).toBe(formatDateTime(time)));
      expect(cell(table, stop.name, "Execution price").textContent).toBe(formatMoney(price, stop.side === "buy" ? "USD" : "EUR"));
    }
  });
});
