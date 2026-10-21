/** Scalable has no bracket order: take profit is a limit sell and stop loss is a stop sell, placed after the buy. */
export type ProtectionKind = "limit" | "stop";

export const PROTECTION_LEGS: { kind: ProtectionKind; label: string; priceLabel: string }[] = [
  { kind: "limit", label: "Take profit", priceLabel: "Take profit price" },
  { kind: "stop", label: "Stop loss", priceLabel: "Stop loss price" },
];

/** A take profit belongs above the price paid and a stop loss below it; checked only when that price is known. */
export function protectionIssue(kind: ProtectionKind, price: number | null, reference: number | null): string | null {
  if (price === null || price <= 0) return kind === "limit" ? "Enter a take profit price." : "Enter a stop loss price.";
  if (reference === null) return null;
  if (kind === "limit" && price <= reference) return "A take profit price should be above your buy price.";
  if (kind === "stop" && price >= reference) return "A stop loss price should be below your buy price.";
  return null;
}
