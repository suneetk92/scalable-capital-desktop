import { describe, expect, it } from "vitest";
import { ALIASES, decimalNumber, findRecords, finiteNumber, isRec, parseMaybeJson, pick, pickNumber, pickString, recordsOf, stringsOf } from "./response";

describe("parseMaybeJson", () => {
  it("parses JSON objects and lists and leaves everything else as it is", () => {
    expect(parseMaybeJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseMaybeJson("[1,2]")).toEqual([1, 2]);
    expect(parseMaybeJson("12")).toBe("12");
    expect(parseMaybeJson("not json")).toBe("not json");
    expect(parseMaybeJson(null)).toBeNull();
    expect(parseMaybeJson({ a: 1 })).toEqual({ a: 1 });
  });
});

describe("isRec", () => {
  it("accepts objects only", () => {
    expect(isRec({})).toBe(true);
    expect(isRec([])).toBe(false);
    expect(isRec(null)).toBe(false);
    expect(isRec("x")).toBe(false);
  });
});

describe("pick", () => {
  it("matches keys regardless of case and punctuation and skips empty values", () => {
    expect(pick({ Last_Price: 3, other: "" }, ["lastPrice"])).toBe(3);
    expect(pick({ name: "" }, ["name"])).toBeUndefined();
    expect(pick({ name: null, title: "T" }, ["name", "title"])).toBe("T");
    expect(pick("text", ["name"])).toBeUndefined();
    expect(pick([{ name: "x" }], ["name"])).toBeUndefined();
  });

  it("takes the names in the order given", () => {
    expect(pick({ b: 2, a: 1 }, ["a", "b"])).toBe(1);
  });
});

describe("pickString and pickNumber", () => {
  it("reads strings and numbers defensively", () => {
    expect(pickString({ id: 7 }, ["id"])).toBe("7");
    expect(pickString({ id: {} }, ["id"])).toBeUndefined();
    expect(pickNumber({ amount: "12.5" }, ["amount"])).toBe(12.5);
    expect(pickNumber({ amount: "abc" }, ["amount"])).toBeNull();
    expect(pickNumber({}, ["amount"])).toBeNull();
  });
});

describe("finiteNumber and decimalNumber", () => {
  it("finiteNumber takes numbers and plain numeric strings", () => {
    expect(finiteNumber(3)).toBe(3);
    expect(finiteNumber("3.5")).toBe(3.5);
    expect(finiteNumber(" ")).toBeNull();
    expect(finiteNumber(Number.NaN)).toBeNull();
    expect(finiteNumber("1,5")).toBeNull();
    expect(finiteNumber(null)).toBeNull();
  });

  it("decimalNumber also reads a comma as the decimal point", () => {
    expect(decimalNumber("1,5")).toBe(1.5);
    expect(decimalNumber(2)).toBe(2);
    expect(decimalNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(decimalNumber("abc")).toBeNull();
    expect(decimalNumber(undefined)).toBeNull();
  });
});

describe("recordsOf and stringsOf", () => {
  it("keep the records or strings of a list and give an empty list for anything else", () => {
    expect(recordsOf([{ a: 1 }, 2, null, [3], { b: 2 }])).toEqual([{ a: 1 }, { b: 2 }]);
    expect(recordsOf({ a: 1 })).toEqual([]);
    expect(recordsOf(undefined)).toEqual([]);
    expect(stringsOf(["a", 1, "b", null])).toEqual(["a", "b"]);
    expect(stringsOf("a")).toEqual([]);
  });
});

describe("findRecords", () => {
  it("finds the main list wherever it is wrapped, also in JSON text", () => {
    expect(findRecords([{ id: 1 }])).toEqual([{ id: 1 }]);
    expect(findRecords({ data: { items: [{ id: 1 }, { id: 2 }] } })).toEqual([{ id: 1 }, { id: 2 }]);
    expect(findRecords(JSON.stringify({ items: [{ id: 3 }] }))).toEqual([{ id: 3 }]);
    expect(findRecords({ total: 3 })).toEqual([]);
    expect(findRecords(null)).toEqual([]);
  });
});

describe("ALIASES", () => {
  it("lists the provider names for each figure, canonical name first", () => {
    expect(ALIASES.quantity[0]).toBe("quantity");
    expect(ALIASES.quantity).toContain("shares");
    expect(ALIASES.lastPrice[0]).toBe("lastPrice");
    expect(ALIASES.avgPrice).toContain("averagePrice");
  });
});
