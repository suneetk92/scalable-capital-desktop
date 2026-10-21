// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrderDialog, type OrderTarget } from "../OrderDialog";
import { SavingsPlanDialog } from "../pages/SavingsPlanDialog";
import { SignInScreen } from "../SignIn";
import { TrailingStopDialog } from "../TrailingStopDialog";
import { UpdateNotice } from "../UpdateNotice";
import { ConfirmDialog } from "../ui";
import type { Invoke } from "../tools";

afterEach(cleanup);

function mockInvoke(resolve: (command: string, args?: Record<string, unknown>) => unknown): Invoke {
  return vi.fn(async <T = unknown,>(command: string, args?: Record<string, unknown>) => resolve(command, args) as T) as Invoke;
}

const security = { isin: "US0378331005", name: "Apple Inc.", symbol: "AAPL", currency: "EUR" };
const target: OrderTarget = { side: "buy", security, portfolioId: "portfolio-1", heldQuantity: 0, lastPrice: 100 };
const portfolios = [{ portfolioId: "portfolio-1", name: "Main", buyingPower: 1000, currency: "EUR", holdings: {} }];
const emptyPreview = { previewId: "preview-id-1", preview: { reviewPresentation: { sections: [] } } };
const parseSearch = () => [];

describe("mocked-invoke smoke flows", () => {
  it("shows sign-in guidance while the browser authentication is pending", () => {
    const onSignIn = vi.fn();
    render(<SignInScreen busy error={null} onSignIn={onSignIn} />);

    expect(screen.getByRole("status").textContent).toContain("A browser window has opened");
    expect((screen.getByRole("button", { name: /waiting for secure sign-in/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /waiting for secure sign-in/i }));
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it("confirms an order with the ID returned by its preview", async () => {
    const invoke = mockInvoke((command) => {
      if (command === "preview_order") return emptyPreview;
      if (command === "submit_order") return { orderId: "order-1" };
      return undefined;
    });
    const onPlaced = vi.fn();
    render(
      <OrderDialog
        target={target}
        defaultVenue="gettex"
        portfolios={portfolios}
        invoke={invoke}
        parseSearch={parseSearch}
        formatMoney={(value) => `${value ?? "—"} EUR`}
        onClose={vi.fn()}
        onPlaced={onPlaced}
      />,
    );

    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview buy order" }));
    expect(screen.queryByRole("option", { name: "Account default" })).toBeNull();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("preview_order", expect.objectContaining({ request: expect.objectContaining({ venue: "gettex" }) })));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and place buy order" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("submit_order", expect.objectContaining({ previewId: "preview-id-1" })));
    expect(onPlaced).toHaveBeenCalledOnce();
  });

  it("shows the failed preview request and a venue hint", async () => {
    const invoke = mockInvoke((command) => {
      if (command === "preview_order") throw new Error("Scalable MCP tool preview_sell_order failed. The request could not be completed. Details: error.code=internal_error; error.requestId=req-123");
      return undefined;
    });
    render(
      <OrderDialog
        target={{ ...target, side: "sell", heldQuantity: 100 }}
        defaultVenue="eix"
        portfolios={portfolios}
        invoke={invoke}
        parseSearch={parseSearch}
        formatMoney={(value) => `${value ?? "—"} EUR`}
        onClose={vi.fn()}
        onPlaced={vi.fn()}
      />,
    );

    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview sell order" }));

    expect(await screen.findByText(/requestId=req-123/)).toBeTruthy();
    expect(screen.getByText(/Try another venue \(EIX, Gettex or Xetra\)/)).toBeTruthy();
    fireEvent.click(screen.getByText("What was sent"));
    expect(screen.getByText("preview_sell_order")).toBeTruthy();
    expect(screen.getByText("Apple Inc. (US0378331005)")).toBeTruthy();
    expect(screen.getByText("Main (portfolio-1)")).toBeTruthy();
    expect(screen.getByText("100 shares")).toBeTruthy();
    expect(screen.getByText("EIX", { selector: "dd" })).toBeTruthy();
    expect(screen.getByText("Attempted")).toBeTruthy();
  });

  it("loads plan options and confirms a savings-plan preview by ID", async () => {
    const invoke = mockInvoke((command, args) => {
      if (command === "call_tools") {
        const calls = args?.calls as { name: string }[];
        return calls.map((call) => ({
          name: call.name,
          ok: true,
          result: {
            amountLimits: { min: 1, max: 1000 },
            frequencies: ["monthly"],
            paymentMethods: ["cash"],
            dynamizationRates: ["0"],
            schedules: [{ dayOfMonth: 1, availableYearMonths: ["2026-11"] }],
            defaults: { frequency: "monthly", dayOfMonth: 1, yearMonth: "2026-11", dynamizationRate: "0", paymentMethod: "cash" },
          },
        }));
      }
      if (command === "preview_savings_plan") return emptyPreview;
      if (command === "submit_savings_plan") return { savingsPlan: { amount: "50" } };
      return undefined;
    });
    const onSaved = vi.fn();
    render(
      <SavingsPlanDialog
        existing={{ isin: security.isin, name: security.name, amount: "50", frequency: "monthly", dayOfMonth: "1", dynamizationRate: "0", paymentMethod: "cash" }}
        portfolios={portfolios}
        portfolioId="portfolio-1"
        invoke={invoke}
        parseSearch={parseSearch}
        tradingEnabled
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Preview plan" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and save plan" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("submit_savings_plan", expect.objectContaining({ previewId: "preview-id-1" })));
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("creates a trailing stop only after the acknowledgement", async () => {
    const invoke = mockInvoke((command) => (command === "add_trailing_stop" ? { id: "stop-1" } : undefined));
    const onClose = vi.fn();
    render(<TrailingStopDialog security={security} portfolioId="portfolio-1" quantity="2" portfolios={portfolios} invoke={invoke} parseSearch={parseSearch} tradingEnabled onClose={onClose} />);

    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "5" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /i understand/i }));
    fireEvent.click(screen.getByRole("button", { name: "Start trailing stop" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("add_trailing_stop", expect.objectContaining({ request: expect.objectContaining({ shares: 2 }) })));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("installs or dismisses the updater notice and confirms sign-out", () => {
    const onInstall = vi.fn();
    const onDismiss = vi.fn();
    const info = { version: "1.1.0", currentVersion: "1.0.0", notes: "Fixes", date: null, canInstall: true, releaseUrl: "https://example.com/releases" };
    const { rerender } = render(<UpdateNotice info={info} state={{ status: "idle" }} onInstall={onInstall} onOpenReleasePage={vi.fn()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Install and restart" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onInstall).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();

    const onConfirm = vi.fn();
    rerender(<ConfirmDialog title="Sign out?" text="You will need to sign in again." confirmLabel="Sign out" onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
