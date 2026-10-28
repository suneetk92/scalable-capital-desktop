// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { TrailingTransactionDialog } from "./TrailingTransactionDialog";
import { parseTrailingList } from "./trailing";

afterEach(cleanup);

const stored = {
  id: "a",
  isin: "US0378331005",
  name: "Apple Inc.",
  side: "buy",
  shares: 0,
  amount: 250,
  trail: { kind: "percent", value: 5 },
  startPrice: 100,
  high: 90,
  lastPrice: 95,
  status: "sold",
  soldPrice: 94.5,
  executedAt: 1_700_000_000,
  receipt: { orderId: "o-1" },
  createdAt: 1,
};

describe("trailing transaction dialog", () => {
  it("shows what was bought and what Scalable answered", () => {
    const [stop] = parseTrailingList({ stops: [stored] }).stops;
    render(<TrailingTransactionDialog stop={stop} onClose={() => {}} />);
    expect(screen.getByText("Bought: Apple Inc.")).toBeTruthy();
    expect(screen.getByText("Lowest price seen")).toBeTruthy();
    expect(screen.getByText("o-1")).toBeTruthy();
  });

  it("copes with a stop sold before the transaction was recorded", () => {
    const [stop] = parseTrailingList({ stops: [{ ...stored, side: "sell", shares: 2, executedAt: undefined, receipt: undefined }] }).stops;
    render(<TrailingTransactionDialog stop={stop} onClose={() => {}} />);
    expect(screen.getByText("Not recorded")).toBeTruthy();
    expect(screen.queryByText("Scalable's answer")).toBeNull();
  });
});
