import { describe, expect, it } from "vitest";
import { describeSchemaType, schemaArguments } from "./toolSchema";

describe("describeSchemaType", () => {
  it("describes plain, enum, array and union types", () => {
    expect(describeSchemaType({ type: "string" })).toBe("string");
    expect(describeSchemaType({ type: "string", enum: ["one_day", "max"] })).toBe("one_day | max");
    expect(describeSchemaType({ type: "array", items: { type: "string" } })).toBe("array of string");
    expect(describeSchemaType({ anyOf: [{ type: "string" }, { type: "number" }] })).toBe("string or number");
    expect(describeSchemaType({ type: "string", const: "security" })).toBe('"security"');
    expect(describeSchemaType({ type: "object", properties: { kind: {}, isin: {} } })).toBe("object { kind, isin }");
    expect(describeSchemaType(undefined)).toBe("any");
  });
});

describe("schemaArguments", () => {
  it("lists required properties first and keeps descriptions", () => {
    const rows = schemaArguments({
      properties: { portfolioId: { type: "string", description: "Optional portfolio id." }, isin: { type: "string" } },
      required: ["isin"],
    });
    expect(rows.map((row) => [row.name, row.required])).toEqual([
      ["isin", true],
      ["portfolioId", false],
    ]);
    expect(rows[1].description).toBe("Optional portfolio id.");
  });

  it("returns nothing for a tool without arguments", () => {
    expect(schemaArguments({ type: "object", properties: {} })).toEqual([]);
    expect(schemaArguments(null)).toEqual([]);
  });
});
