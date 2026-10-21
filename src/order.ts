export function amountExceedsBuyingPower(amount: number, buyingPower: number | null) {
  return buyingPower !== null && amount > buyingPower;
}

export function quantityExceedsHolding(shares: number, heldShares: number | null) {
  return heldShares !== null && shares > heldShares;
}

export function previewFailureHint(error: string): string | null {
  const normalized = error.toLowerCase();
  if (!normalized.includes("could not be completed") && !normalized.includes("internal_error")) return null;
  return "Scalable did not identify a specific cause. The security may not be tradable at the selected venue (for example, a turbo may be knocked out), or Scalable may be temporarily unavailable. Try another venue (EIX, Gettex or Xetra), then preview again. If it still fails, wait a little and try again.";
}

/** Scalable publishes no tick-size table; the finest MiFID II tick is 0.0001, so more decimals can never be a valid price. */
const MAX_PRICE_DECIMALS = 4;
/** Amounts are money, so they stop at the cent. */
const MAX_AMOUNT_DECIMALS = 2;
/** The app's own floor for an amount order; Scalable's preview enforces its real minimum. */
const MIN_ORDER_AMOUNT = 1;

export function decimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const [mantissa, exponent] = String(Math.abs(value)).toLowerCase().split("e");
  const fraction = mantissa.split(".")[1]?.length ?? 0;
  return Math.max(0, fraction - Number(exponent ?? 0));
}

export function amountIssue(amount: number): string | null {
  if (decimalPlaces(amount) > MAX_AMOUNT_DECIMALS) return `Amounts take at most ${MAX_AMOUNT_DECIMALS} decimal places.`;
  if (amount < MIN_ORDER_AMOUNT) return `Enter an amount of at least ${MIN_ORDER_AMOUNT}.`;
  return null;
}

export function priceIssue(price: number): string | null {
  return decimalPlaces(price) > MAX_PRICE_DECIMALS ? `Prices take at most ${MAX_PRICE_DECIMALS} decimal places.` : null;
}

/** A stop on the market's side of the price would trigger at once; Scalable rejects it, so the dialog does too. */
export function stopPriceIssue(side: "buy" | "sell", stop: number, lastPrice: number | null, format: (price: number) => string): string | null {
  if (lastPrice === null || !(lastPrice > 0)) return null;
  if (side === "buy" && stop <= lastPrice) return `A buy stop must be above the current price of ${format(lastPrice)}, or it would trigger at once. Use a market or limit order to buy now.`;
  if (side === "sell" && stop >= lastPrice) return `A sell stop must be below the current price of ${format(lastPrice)}, or it would trigger at once. Use a market or limit order to sell now.`;
  return null;
}

/** A limit on the market's side of the price is allowed, but fills right away: a hint, not a block. */
export function limitPriceHint(side: "buy" | "sell", limit: number, lastPrice: number | null, format: (price: number) => string): string | null {
  if (lastPrice === null || !(lastPrice > 0)) return null;
  if (side === "buy" && limit >= lastPrice) return `The limit is at or above the current price of ${format(lastPrice)}, so the order can fill right away.`;
  if (side === "sell" && limit <= lastPrice) return `The limit is at or below the current price of ${format(lastPrice)}, so the order can fill right away.`;
  return null;
}

/** Quantity held per ISIN in one portfolio; several rows of the same ISIN (e.g. lots) add up. */
export function holdingsByIsin(rows: { portfolioId: string; isin: string; quantity: number | null }[], portfolioId: string) {
  const held: Record<string, number> = {};
  for (const row of rows) {
    if (row.portfolioId !== portfolioId || !row.isin || row.quantity === null) continue;
    held[row.isin] = (held[row.isin] ?? 0) + row.quantity;
  }
  return held;
}
