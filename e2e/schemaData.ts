import tools from "../tests/fixtures/mcp-tool-list.json" with { type: "json" };

type Schema = { type?: string | string[]; properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[]; oneOf?: Schema[]; enum?: unknown[]; format?: string };

const outputSchemas: Record<string, Schema | undefined> = Object.fromEntries(
  (tools.result.tools as unknown as { name: string; outputSchema?: Schema }[]).map((tool) => [tool.name, tool.outputSchema]),
);

const ISINS = ["DE0007030009", "DE0007100000", "US0378331005", "US5949181045", "IE00B4L5Y983"];

const NAMES = ["Rheinmetall", "Mercedes-Benz Group", "Apple", "Microsoft", "iShares Core MSCI World"];
const BY_KEY: [RegExp, (index: number) => string][] = [
  [/isin/i, (i) => ISINS[i % ISINS.length]],
  [/timestamp|date|at$/i, (i) => `2026-01-0${i + 2}T09:30:00Z`],
  [/currency/i, () => "EUR"],
  [/^(side|direction)$/i, (i) => ["BUY", "SELL"][i % 2]],
  [/^status$/i, (i) => ["EXECUTED", "PENDING"][i % 2]],
  [/transactiontype/i, (i) => ["SECURITY_TRANSACTION", "SAVINGS_PLAN_EXECUTION"][i % 2]],
  [/frequency/i, () => "MONTHLY"],
  [/amount|price|quantity|valuation|performance|return|rate/i, (i) => String(250 + i * 125)],
  [/ticker/i, (i) => ["RHM", "MBG", "AAPL", "MSFT", "IWDA"][i % 5]],
  [/name/i, (i) => NAMES[i % NAMES.length]],
];

function text(key: string, format: string | undefined, index: number): string {
  if (format === "date-time") return `2026-01-0${index + 2}T09:30:00Z`;
  return (BY_KEY.find(([pattern]) => pattern.test(key))?.[1] ?? ((i) => `${key || "text"} ${i + 1}`))(index);
}

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
      return text(key, schema.format, index);
    default:
      return null;
  }
}

/** A made-up result for a read tool, shaped by its published output schema. */
export function generateResult(tool: string): unknown {
  return generate(outputSchemas[tool]);
}
