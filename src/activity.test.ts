import { describe, expect, it } from "vite-plus/test";
import { summarizeActivity } from "./activity";
import type { Rec } from "./response";

const rows = (...records: Rec[]) => records.map((record) => ({ record, portfolioId: "p" }));

const buy = (id: string, quantity: number, amount: number, extra: Rec = {}): Rec => ({
  id,
  status: "SETTLED",
  currency: "EUR",
  security: { isin: "US0378331005", name: "Apple", side: "BUY", quantity: String(quantity) },
  amount: -amount,
  ...extra,
});

describe("summarizeActivity", () => {
  it("sums buys and sells by size and works out the net invested", () => {
    const summary = summarizeActivity(rows(buy("1", 2, 200), buy("2", 2, 300), { id: "3", status: "SETTLED", security: { isin: "US0378331005", side: "SELL", quantity: "1" }, amount: 180 }));
    expect(summary.bought).toBe(500);
    expect(summary.sold).toBe(180);
    expect(summary.netInvested).toBe(320);
    expect(summary.currency).toBe("EUR");
  });

  it("takes fees and taxes from fee and tax cash transactions", () => {
    const summary = summarizeActivity(
      rows(
        buy("1", 1, 100),
        { id: "2", kind: "cash", status: "SETTLED", cash: { transactionType: "FEE", amount: "-2.5", relatedIsin: "US0378331005" } },
        { id: "3", kind: "cash", status: "SETTLED", cash: { transactionType: "TAX", amount: "-4" } },
      ),
    );
    expect(summary).toMatchObject({ fees: 2.5, taxes: 4, bought: 100 });
    expect(summary.securities[0]?.fees).toBe(2.5);
  });

  it("totals dividends, interest, deposits and withdrawals", () => {
    const summary = summarizeActivity(
      rows(
        { id: "1", cash: { transactionType: "DIVIDEND", amount: "12", relatedIsin: "US0378331005" } },
        { id: "2", cash: { transactionType: "INTEREST", amount: "3" } },
        { id: "3", cash: { transactionType: "DEPOSIT", amount: "1000" } },
        { id: "4", cash: { transactionType: "WITHDRAWAL", amount: "-400" } },
      ),
    );
    expect(summary).toMatchObject({ dividends: 12, interest: 3, deposits: 1000, withdrawals: 400, netDeposits: 600 });
    expect(summary.securities[0]).toMatchObject({ isin: "US0378331005", dividends: 12 });
  });

  it("reads distributions and payouts as dividends", () => {
    const summary = summarizeActivity(
      rows({ id: "1", kind: "cash", cash: { transactionType: "DISTRIBUTION", amount: "5", relatedIsin: "IE00B4L5Y983" } }, { id: "2", kind: "cash", type: "DIVIDEND_PAYOUT", amount: "7" }),
    );
    expect(summary.dividends).toBe(12);
  });

  it("keeps the sign of cash transactions so refunds and corrections net out", () => {
    const cash = (id: string, type: string, amount: number, relatedIsin?: string): Rec => ({
      id,
      status: "SETTLED",
      cash: { transactionType: type, amount: String(amount), ...(relatedIsin ? { relatedIsin } : {}) },
    });
    const summary = summarizeActivity(
      rows(
        cash("1", "DISTRIBUTION", 4.3, "FR0000125338"),
        cash("2", "DISTRIBUTION", -4.22, "FR0000125338"),
        cash("3", "FEE", -4.99),
        cash("4", "FEE", 29.9),
        cash("5", "TAX", -0.17),
        cash("6", "TAX_RETURN", 31.11),
        cash("7", "INTEREST", -72.73),
        cash("8", "INTEREST", 4.18),
        cash("9", "DEPOSIT", 1000),
        cash("10", "WITHDRAWAL", -4772.94),
      ),
    );
    expect(summary.dividends).toBeCloseTo(0.08);
    expect(summary.fees).toBeCloseTo(-24.91);
    expect(summary.taxes).toBeCloseTo(-30.94);
    expect(summary.interest).toBeCloseTo(-68.55);
    expect(summary).toMatchObject({ deposits: 1000, withdrawals: 4772.94 });
    expect(summary.securities[0]?.dividends).toBeCloseTo(0.08);
  });

  it("counts a swap in as a buy and a swap out as a sell", () => {
    const summary = summarizeActivity(
      rows(
        { id: "1", status: "SETTLED", nonTradeSecurity: { transactionType: "SWAP_OUT", isin: "DE000UG8KVL2", quantity: "50", amount: "0.05" } },
        { id: "2", status: "SETTLED", nonTradeSecurity: { transactionType: "SWAP_IN", isin: "DE000UG8KVL3", quantity: "50", amount: "0.5" } },
      ),
    );
    expect(summary).toMatchObject({ counted: 2, bought: 0.5, sold: 0.05, ignored: [] });
    expect(summary.securities.map((security) => security.isin).sort()).toEqual(["DE000UG8KVL2", "DE000UG8KVL3"]);
  });

  it("says how many transactions were counted and why the rest were left out", () => {
    const summary = summarizeActivity(
      rows(
        buy("1", 1, 100),
        buy("2", 1, 50, { status: "PENDING" }),
        buy("3", 1, 70, { status: "CANCELLED" }),
        { id: "4", cash: { transactionType: "SPLIT", amount: "0" } },
        { id: "5", cash: { transactionType: "SPLIT", amount: "0" } },
      ),
    );
    expect(summary).toMatchObject({ total: 5, counted: 1 });
    expect(summary.ignored).toHaveLength(2);
    expect(summary.ignored).toEqual(
      expect.arrayContaining([
        { label: "Split", count: 2 },
        { label: "Open, cancelled or rejected orders", count: 2 },
      ]),
    );
  });

  it("leaves out open, cancelled and unknown transactions and counts each transaction once", () => {
    const summary = summarizeActivity(
      rows(buy("1", 1, 100), buy("1", 1, 100), buy("2", 1, 50, { status: "PENDING" }), buy("3", 1, 70, { status: "CANCELLED" }), { id: "4", type: "SOMETHING_ELSE", amount: 9 }),
    );
    expect(summary.counted).toBe(1);
    expect(summary.bought).toBe(100);
  });

  it("gives each security its average buy price and realised result", () => {
    const summary = summarizeActivity(
      rows(
        buy("1", 2, 200),
        buy("2", 2, 300),
        { id: "3", status: "SETTLED", security: { isin: "US0378331005", side: "SELL", quantity: "2" }, amount: 320 },
        { id: "4", status: "SETTLED", security: { isin: "DE0007164600", name: "SAP", side: "BUY", quantity: "1" }, amount: -100 },
      ),
    );
    expect(summary.securities.map((security) => security.isin)).toEqual(["US0378331005", "DE0007164600"]);
    const apple = summary.securities[0];
    expect(apple).toMatchObject({ name: "Apple", boughtQuantity: 4, soldQuantity: 2, averageBuyPrice: 125 });
    expect(apple?.realised).toBe(70);
    expect(summary.securities[1]?.realised).toBeNull();
  });

  it("skips cancellations and reads fund and crypto transactions", () => {
    const summary = summarizeActivity(
      rows(
        buy("1", 1, 100, { isCancellation: true }),
        { id: "2", kind: "eltif", status: "SETTLED", eltif: { isin: "LU0000000001", transactionType: "BUY", side: "BUY", quantity: "2", amount: "-50" } },
        { id: "3", status: "SETTLED", side: "SELL", ticker: "BTC", quantity: "0.1", amount: "30" },
      ),
    );
    expect(summary).toMatchObject({ counted: 2, bought: 50, sold: 30 });
    expect(summary.securities.map((security) => security.isin)).toEqual(["LU0000000001"]);
  });

  it("returns zeros for no transactions", () => {
    expect(summarizeActivity([], "USD")).toMatchObject({ counted: 0, bought: 0, fees: 0, currency: "USD", securities: [] });
  });
});
