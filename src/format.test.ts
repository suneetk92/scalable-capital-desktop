import { describe, expect, it } from "vite-plus/test";
import { ambiguousThousands, ambiguousThousandsMessage, formatDate, formatDateTime, formatMoney, formatNumber, formatPercent, LOCALE, parseDecimal, pluralize } from "./format";

describe("shared formatters", () => {
  it("uses one locale and one dash for missing or invalid values", () => {
    expect(LOCALE).toBe("en-GB");
    expect(formatNumber(null)).toBe("—");
    expect(formatMoney(null)).toBe("—");
    expect(formatPercent(null)).toBe("—");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not a date")).toBe("—");
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("not a date")).toBe("—");
  });

  it("includes the selected time zone on instants", () => {
    expect(formatDateTime("2026-01-02T03:04:00Z", "UTC")).toContain("UTC");
    expect(formatDate("2026-01-02")).toBe(formatDate(new Date("2026-01-02T00:00:00Z"), { dateStyle: "medium", timeZone: "UTC" }));
  });

  it("formats money, numbers, percentages and dates with the shared locale", () => {
    expect(formatMoney(1234.5, "EUR")).toBe(new Intl.NumberFormat(LOCALE, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1234.5));
    expect(formatNumber(1234.5)).toBe(new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(1234.5));
    expect(formatPercent(1.25)).toBe("+1.25%");
    expect(formatDate(new Date("2026-10-20T12:00:00Z"), { dateStyle: "medium", timeZone: "UTC" })).toBe(
      new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeZone: "UTC" }).format(new Date("2026-10-20T12:00:00Z")),
    );
  });
});

describe("parseDecimal", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["1234,56", 1234.56],
    ["1234.56", 1234.56],
    ["1 234,56", 1234.56],
    ["−12,5", -12.5],
    ["1,234,567", 1234567],
    ["5.", 5],
    ["5,", 5],
    [",5", 0.5],
  ])("parses %s", (input, expected) => expect(parseDecimal(input)).toBe(expected));

  it.each(["", " ", ".", "1,2,3", "1.23.4", "1,234.5,6", "abc", "Infinity"])("rejects malformed decimal %s", (input) => expect(parseDecimal(input)).toBeNull());
});

describe("ambiguousThousands", () => {
  it.each(["1,000", "12.500", "999,999", " -1,000 ", "+2.000"])("flags %s, which could be thousands", (input) => expect(ambiguousThousands(input)).toBe(true));

  it.each(["1000", "1,000.00", "1.000,00", "1,5", "1,25", "1,2345", "1234,567", "1,234,567", "", "abc"])("accepts %s", (input) => expect(ambiguousThousands(input)).toBe(false));

  it("names the input in the message", () => {
    expect(ambiguousThousandsMessage(" 1,000 ")).toBe("Write 1000 or 1000.00 — “1,000” could mean 1 or 1000.");
  });
});

describe("pluralize", () => {
  it("uses the singular only for one and accepts irregular plurals", () => {
    expect(pluralize(1, "row")).toBe("1 row");
    expect(pluralize(2, "row")).toBe("2 rows");
    expect(pluralize(0, "security", "securities")).toBe("0 securities");
  });
});
