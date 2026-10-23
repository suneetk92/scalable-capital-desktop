// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Invoke } from "../../../../src/tools";
import { TrailingStopDialog } from "./TrailingStopDialog";

afterEach(cleanup);

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
        tradingEnabled
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
    render(<TrailingStopDialog side="buy" security={security} portfolioId="portfolio-1" quantity="" portfolios={portfolios} held={[]} invoke={invoke} tradingEnabled onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: /amount to spend/i }), { target: { value: "250" } });
    fireEvent.change(screen.getByRole("textbox", { name: /distance above the low/i }), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /i understand/i }));
    fireEvent.click(screen.getByRole("button", { name: "Start trailing buy stop" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("add_trailing_stop", expect.objectContaining({ request: expect.objectContaining({ side: "buy", amount: 250 }) })));
  });
});
