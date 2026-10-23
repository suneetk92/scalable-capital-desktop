import tools from "../tests/fixtures/mcp-tool-list.json" with { type: "json" };

type Schema = { type?: string | string[]; properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[]; oneOf?: Schema[]; enum?: unknown[]; format?: string };

const outputSchemas: Record<string, Schema | undefined> = Object.fromEntries(
  (tools.result.tools as { name: string; outputSchema?: Schema }[]).map((tool) => [tool.name, tool.outputSchema]),
);

const ISINS = ["DE0007030009", "DE0007100000", "US0378331005", "US5949181045", "IE00B4L5Y983"];

/** A value that satisfies `schema`, picking the first non-null variant; arrays get two items. Deterministic, so tests are stable. */
export function generate(schema: Schema | undefined, key = "", index = 0): unknown {
  if (!schema) return null;
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants) return generate(variants.find((variant) => variant.type !== "null") ?? variants[0], key, index);
  if (schema.enum) return schema.enum[index % schema.enum.length];
  const type = Array.isArray(schema.type) ? (schema.type.find((item) => item !== "null") ?? "null") : schema.type;
  switch (type) {
    case "object":
      return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([name, child]) => [name, generate(child, name, index)]));
    case "array":
      return [0, 1].map((item) => generate(schema.items, key, item));
    case "number":
    case "integer":
      return 100 + index * 10 + (/price|amount|value/i.test(key) ? 0.5 : 0);
    case "boolean":
      return false;
    case "string":
      if (/isin/i.test(key)) return ISINS[index % ISINS.length];
      if (schema.format === "date-time" || /timestamp|at$/i.test(key)) return "2026-01-02T09:30:00Z";
      if (/currency/i.test(key)) return "EUR";
      return `${key || "text"} ${index + 1}`;
    default:
      return null;
  }
}

/** A made-up result for a read tool, shaped by its published output schema. */
export function generateResult(tool: string): unknown {
  return generate(outputSchemas[tool]);
}
