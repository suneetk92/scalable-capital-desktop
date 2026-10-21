import { describe, expect, it } from "vitest";
import { appendPage, overnightRequest, parseOvernightPage, periodStart } from "./overnight";

describe("parseOvernightPage", () => {
  it("reads transactions, account and pagination from the published shape", () => {
    expect(
      parseOvernightPage({
        account: { displayName: "Overnight", ownerKind: "personal", isActive: true },
        savingsAccountId: "account-1",
        page: { nextCursor: "next", totalCount: 2, returnedCount: 1 },
        transactions: [
          {
            id: "t1",
            lastEventAt: "2025-01-02T12:00:00Z",
            cashTransactionType: "interest",
            type: "CASH",
            amount: "12.34",
            currency: "EUR",
            status: "BOOKED",
            description: "Interest",
            isCancellation: false,
            documents: [],
          },
        ],
      }),
    ).toEqual({
      account: { displayName: "Overnight", ownerKind: "personal", isActive: true },
      savingsAccountId: "account-1",
      transactions: [
        {
          id: "t1",
          when: "2025-01-02T12:00:00Z",
          kind: "interest",
          status: "BOOKED",
          description: "Interest",
          amount: 12.34,
          currency: "EUR",
          cancellation: false,
          documents: [],
        },
      ],
      nextCursor: "next",
      total: 2,
      error: null,
    });
  });

  it("handles empty and malformed results without throwing", () => {
    expect(parseOvernightPage({})).toMatchObject({ account: null, transactions: [], nextCursor: null, total: 0, error: null });
    expect(parseOvernightPage("not json")).toMatchObject({ transactions: [], total: 0 });
    expect(parseOvernightPage({ transactions: [{ type: "deposit" }, null] }).transactions).toEqual([]);
  });

  it("reads the tool error and keeps only HTTPS document links", () => {
    const page = parseOvernightPage({
      error: { code: "input_invalid", message: "Choose an active account." },
      transactions: [
        {
          id: "t1",
          amount: "1.234,56",
          documents: [
            { id: "d1", label: "Statement", url: "https://example.test/statement" },
            { id: "d2", label: "Local", url: "http://example.test/statement" },
            { id: "d3", label: "Invalid", url: "not a URL" },
          ],
        },
      ],
    });
    expect(page.error).toBe("Choose an active account.");
    expect(page.transactions[0]?.amount).toBe(1234.56);
    expect(page.transactions[0]?.documents).toEqual([{ id: "d1", label: "Statement", url: "https://example.test/statement" }]);
  });
});

describe("overnightRequest", () => {
  it("omits empty filters and maps type, time, paging and account properties", () => {
    const now = new Date("2025-01-31T12:34:56.789Z");
    expect(overnightRequest({ searchTerm: "  ", type: "all", period: "all", pageSize: 0 }, now)).toEqual({ pageSize: 1 });
    expect(overnightRequest({ searchTerm: "  interest  ", type: "interest", period: "7d", cursor: "c1", pageSize: 150, savingsAccountId: "a1" }, now)).toEqual({
      searchTerm: "interest",
      cursor: "c1",
      savingsAccountId: "a1",
      pageSize: 100,
      fromTime: "2025-01-24T12:34:56Z",
      transactionTypes: ["interest"],
    });
  });

  it("formats period bounds at whole-second precision", () => {
    expect(periodStart("30d", new Date("2025-01-31T12:34:56.789Z"))).toBe("2025-01-01T12:34:56Z");
    expect(periodStart("all", new Date("2025-01-31T12:34:56.789Z"))).toBeUndefined();
  });
});

describe("appendPage", () => {
  it("appends only transactions not already present by id", () => {
    const original = parseOvernightPage({ transactions: [{ id: "a" }, { id: "b" }] }).transactions;
    const next = parseOvernightPage({ transactions: [{ id: "b" }, { id: "c" }] }).transactions;
    expect(appendPage(original, next).map((row) => row.id)).toEqual(["a", "b", "c"]);
  });
});
