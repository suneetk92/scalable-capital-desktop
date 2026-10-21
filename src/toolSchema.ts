import type { Rec } from "./response";

/** A tool as `tools/list` publishes it. Which fields are present depends on Scalable. */
export type PublishedTool = {
  name: string;
  title?: string | null;
  description?: string | null;
  inputSchema?: Rec | null;
  outputSchema?: Rec | null;
  annotations?: Rec | null;
};

type ArgumentRow = { name: string; type: string; required: boolean; description: string };

const isObject = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);

/** A short, readable type for a JSON schema node: "string", "one_day | one_week", "array of string", "a or b". */
export function describeSchemaType(node: unknown): string {
  if (!isObject(node)) return "any";
  if ("const" in node) return JSON.stringify(node.const);
  if (Array.isArray(node.enum) && node.enum.length > 0) return node.enum.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(" | ");
  for (const key of ["oneOf", "anyOf"] as const) {
    const options = node[key];
    if (Array.isArray(options) && options.length > 0) return [...new Set(options.map(describeSchemaType))].join(" or ");
  }
  const type = Array.isArray(node.type) ? node.type.join(" or ") : typeof node.type === "string" ? node.type : "";
  if (type === "array") return `array of ${describeSchemaType(node.items)}`;
  if (type === "object" && isObject(node.properties)) return `object { ${Object.keys(node.properties).join(", ")} }`;
  return type || "any";
}

/** The top-level properties of an object schema, required ones first, then in published order. */
export function schemaArguments(schema: Rec | null | undefined): ArgumentRow[] {
  const properties = isObject(schema?.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required.filter((item): item is string => typeof item === "string") : []);
  const rows = Object.entries(properties).map(([name, node]) => ({
    name,
    type: describeSchemaType(node),
    required: required.has(name),
    description: isObject(node) && typeof node.description === "string" ? node.description : "",
  }));
  return [...rows.filter((row) => row.required), ...rows.filter((row) => !row.required)];
}
