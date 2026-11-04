// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Invoke } from "../../../../src/tools";
import { TrailingStopDialog } from "./TrailingStopDialog";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockInvoke(resolve: (command: string, args?: Record<string, unknown>) => unknown): Invoke {
  return vi.fn(async <T = unknown,>(command: string, args?: Record<string, unknown>) => resolve(command, args) as T) as Invoke;
}

const security = { isin: "US0378331005", name: "Apple Inc.", symbol: "AAPL", currency: "EUR" };
const portfolios = [{ portfolioId: "portfolio-1", name: "Main", buyingPower: 1000, currency: "EUR", holdings: {} }];

describe("trailing stop dialog", () => {
  it("creates a trailing stop only after the acknowledgement", async () => {
    const invoke = mockInvoke((command) => (command === "add_trailing_stop" ? { id: "stop-1" } : undefined));
    const onClose = vi.fn();
    render(
      <TrailingStopDialog
        security={security}
        portfolioId="portfolio-1"
        quantity="2"
        portfolios={portfolios}
        held={[{ portfolioId: "portfolio-1", isin: security.isin, name: security.name, symbol: security.symbol, currency: security.currency, quantity: 5 }]}
        invoke={invoke}
        manageEnabled
        onClose={onClose}
      />,
    );

    expect(screen.getByText(/you hold 5 shares/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sell all" }));
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "5" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /i understand/i }));
    fireEvent.click(screen.getByRole("button", { name: "Start trailing stop" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("add_trailing_stop", expect.objectContaining({ request: expect.objectContaining({ shares: 5 }) })));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("creates a trailing buy stop with an amount", async () => {
    const invoke = mockInvoke((command) => (command === "add_trailing_stop" ? { id: "stop-2" } : undefined));
    render(<TrailingStopDialog side="buy" security={security} portfolioId="portfolio-1" quantity="" portfolios={portfolios} held={[]} invoke={invoke} manageEnabled onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: /amount to spend/i }), { target: { value: "250" } });
    fireEvent.change(screen.getByRole("textbox", { name: /distance above the low/i }), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /i understand/i }));
    fireEvent.click(screen.getByRole("button", { name: "Start trailing buy stop" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("add_trailing_stop", expect.objectContaining({ request: expect.objectContaining({ side: "buy", amount: 250 }) })));
  });

  it("creates a trailing buy stop with whole shares", async () => {
    const invoke = mockInvoke((command) => (command === "add_trailing_stop" ? { id: "stop-3" } : undefined));
    render(<TrailingStopDialog side="buy" security={security} portfolioId="portfolio-1" quantity="" portfolios={portfolios} held={[]} invoke={invoke} manageEnabled onClose={vi.fn()} />);

    fireEvent.click(screen.getByText("Amount", { exact: true }));
    fireEvent.click(screen.getByRole("option", { name: "Shares" }));
    fireEvent.change(screen.getByRole("textbox", { name: /shares to buy/i }), { target: { value: "3" } });
    fireEvent.change(screen.getByRole("textbox", { name: /distance above the low/i }), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /i understand/i }));
    fireEvent.click(screen.getByRole("button", { name: "Start trailing buy stop" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("add_trailing_stop", expect.objectContaining({ request: expect.objectContaining({ side: "buy", shares: 3 }) })));
    expect(invoke).not.toHaveBeenCalledWith("add_trailing_stop", expect.objectContaining({ request: expect.objectContaining({ amount: expect.anything() }) }));
  });

  it("requires whole shares and allows switching size when editing", async () => {
    const invoke = mockInvoke((command) => (command === "update_trailing_stop" ? { id: "buy-stop" } : undefined));
    const editing = {
      id: "buy-stop",
      side: "buy" as const,
      isin: security.isin,
      name: security.name,
      portfolioId: "portfolio-1",
      quantity: 0,
      amount: 250,
      trail: { kind: "percent" as const, value: 5 },
      startPrice: 100,
      high: 100,
      lastPrice: 100,
      status: "active" as const,
      message: null,
      triggerReached: false,
      soldPrice: null,
      quotePrice: null,
      executedAt: null,
      receipt: null,
      createdAt: 1,
    };
    render(
      <TrailingStopDialog side="buy" security={security} portfolioId="portfolio-1" quantity="" portfolios={portfolios} held={[]} invoke={invoke} manageEnabled onClose={vi.fn()} editing={editing} />,
    );

    fireEvent.click(screen.getByText("Amount", { exact: true }));
    fireEvent.click(screen.getByRole("option", { name: "Shares" }));
    const size = screen.getByRole("textbox", { name: /shares to buy/i });
    expect((size as HTMLInputElement).value).toBe("");
    fireEvent.change(size, { target: { value: "1.5" } });
    expect(screen.getByRole("alert").textContent).toContain("whole number of shares");
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(size, { target: { value: "3" } });
    fireEvent.change(screen.getByRole("textbox", { name: /distance above the low/i }), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /i understand/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("update_trailing_stop", expect.objectContaining({ request: expect.objectContaining({ id: "buy-stop", shares: 3 }) })));
  });

  it("refuses an amount that could mean thousands", () => {
    const invoke = mockInvoke(() => undefined);
    render(<TrailingStopDialog side="buy" security={security} portfolioId="portfolio-1" quantity="" portfolios={portfolios} held={[]} invoke={invoke} manageEnabled onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: /amount to spend/i }), { target: { value: "1,000" } });
    fireEvent.change(screen.getByRole("textbox", { name: /distance above the low/i }), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /i understand/i }));

    expect(screen.getByRole("alert").textContent).toContain("could mean 1 or 1000");
    expect((screen.getByRole("button", { name: "Start trailing buy stop" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
