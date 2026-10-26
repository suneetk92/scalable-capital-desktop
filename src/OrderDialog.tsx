import { Description, Field, Label } from "@headlessui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GroupInput, Select } from "./controls";
import { LINES, PreviewReviewBody } from "./PreviewReview";
import { SecurityPicker } from "./SecurityPicker";
import { PROTECTION_LEGS, protectionIssue, type ProtectionKind } from "./protection";
import { useShowDiagnostics, VENUE_OPTIONS, type VenueSetting } from "./settings";
import { invokeCommand } from "./commands";
import { humanize } from "./tools";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Alert, btn, cx, field, DialogFooter, ModalFrame, ModalTitle, MODAL_TEXT } from "./ui";
import { formatNumber, parseDecimal } from "./format";
import { amountExceedsBuyingPower, amountIssue, limitPriceHint, previewFailureHint, priceIssue, quantityExceedsHolding, stopPriceIssue } from "./order";
import { usePreviewFlow } from "./hooks/usePreviewFlow";
import { extension } from "./extensions";

const SIDE_BUTTON = "h-9 cursor-pointer font-semibold";
const NOTE = `mb-4 ${MODAL_TEXT}`;

export type OrderSide = "buy" | "sell";
type OrderType = "market" | "limit" | "stop";

export type SecurityHit = {
  isin: string;
  name: string;
  symbol: string;
  currency: string;
};

export type OrderTarget = {
  side: OrderSide;
  security: SecurityHit | null;
  portfolioId: string;
  heldQuantity: number | null;
  /** The last price the app has for the security, for the stop and limit checks; `null` when unknown. */
  lastPrice: number | null;
};

export type OrderPortfolio = {
  portfolioId: string;
  name: string;
  buyingPower: number | null;
  currency: string | null;
  holdings: Record<string, number>;
};

type OrderRequest = {
  side: OrderSide;
  isin: string;
  portfolioId: string;
  amount: number | null;
  shares: number | null;
  orderType: OrderType;
  limitPrice: number | null;
  stopPrice: number | null;
  venue: VenueSetting;
};

type Line = { label: string; value: string };
/** What stops the form from being previewed, and the field it belongs to. */
type FormIssue = { field: "security" | "size" | "limit" | "stop"; message: string };
type Validation = { request: OrderRequest; issue: null } | { request: null; issue: FormIssue };
type FailedPreview = { request: OrderRequest; securityName: string; portfolioName: string; portfolioCurrency: string; attemptedAt: string };

const issue = (field: FormIssue["field"], message: string): Validation => ({ request: null, issue: { field, message } });

type Props = {
  target: OrderTarget;
  defaultVenue: VenueSetting;
  portfolios: OrderPortfolio[];
  invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
  parseSearch: (payload: unknown) => SecurityHit[];
  formatMoney: (value: number | null, currency?: string) => string;
  onClose: () => void;
  onPlaced: () => void;
};

function payloadLines(value: unknown, path = "", depth = 0, out: Line[] = []): Line[] {
  if (value === null || value === undefined || value === "" || depth > 4) return out;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed !== null && typeof parsed === "object") return payloadLines(parsed, path, depth + 1, out);
    } catch {
      /* plain text */
    }
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => payloadLines(item, path ? `${path}.${index + 1}` : String(index + 1), depth + 1, out));
    return out;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/confirm|token|submission/i.test(key)) continue;
      payloadLines(child, path ? `${path}.${key}` : key, depth + 1, out);
    }
    return out;
  }
  out.push({ label: humanize(path.split(".").slice(-2).join(" ")), value: String(value) });
  return out;
}

function toNumber(text: string): number | null {
  return parseDecimal(text);
}

export function OrderDialog({ target, defaultVenue, portfolios, invoke, parseSearch, formatMoney, onClose, onPlaced }: Props) {
  const showDiagnostics = useShowDiagnostics();
  const flow = usePreviewFlow();
  const stage = flow.stage === "complete" ? "placed" : flow.stage;
  const { preview, result, accepted, setAccepted, busy, error, setError, review, expiry, allAccepted } = flow;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [side, setSide] = useState<OrderSide>(target.side);
  const [security, setSecurity] = useState<SecurityHit | null>(target.security);
  const [portfolioId, setPortfolioId] = useState(target.portfolioId || portfolios[0]?.portfolioId || "");
  const [sizing, setSizing] = useState<"amount" | "shares">(target.side === "sell" ? "shares" : "amount");
  const [size, setSize] = useState("");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [venue, setVenue] = useState<VenueSetting>(defaultVenue);
  const [failedPreview, setFailedPreview] = useState<FailedPreview | null>(null);
  const [protect, setProtect] = useState<ProtectionKind | null>(null);
  const [protectable, setProtectable] = useState(false);
  const [placedLegs, setPlacedLegs] = useState<ProtectionKind[]>([]);
  const [bought, setBought] = useState<{ quantity: number | null; limitPrice: number | null }>({ quantity: null, limitPrice: null });

  const portfolio = portfolios.find((item) => item.portfolioId === portfolioId);
  const currency = security?.currency ?? "EUR";
  const orderCurrency = portfolio?.currency ?? null;
  const orderMoney = useCallback((value: number | null) => (orderCurrency ? formatMoney(value, orderCurrency) : formatNumber(value)), [formatMoney, orderCurrency]);
  const heldQuantity = security
    ? (portfolio?.holdings[security.isin] ??
      (portfolioId === target.portfolioId && security.isin === target.security?.isin ? target.heldQuantity : null) ??
      (portfolio && Object.keys(portfolio.holdings).length > 0 ? 0 : null))
    : null;
  // Only known for the security the dialog was opened with; a security picked in the dialog has no price here.
  const lastPrice = security && security.isin === target.security?.isin ? target.lastPrice : null;
  const priceOf = useCallback((price: number) => formatMoney(price, currency), [currency, formatMoney]);

  const previousStage = useRef(stage);
  useEffect(() => {
    if (previousStage.current !== stage) titleRef.current?.focus();
    previousStage.current = stage;
  }, [stage]);

  const validation = useMemo<Validation>(() => {
    if (!security) return issue("security", "Choose a security first.");
    const number = toNumber(size);
    if (number === null || number <= 0) return issue("size", sizing === "amount" ? "Enter an amount greater than zero." : "Enter a number of shares greater than zero.");
    if (side === "buy" && sizing === "shares" && !Number.isInteger(number)) return issue("size", "Buy orders accept whole shares only.");
    const amountProblem = sizing === "amount" ? amountIssue(number) : null;
    if (amountProblem) return issue("size", amountProblem);
    const availableBuyingPower = portfolio?.buyingPower ?? null;
    if (side === "buy" && sizing === "amount" && amountExceedsBuyingPower(number, availableBuyingPower)) {
      return issue("size", `Amount exceeds buying power of ${orderMoney(availableBuyingPower)}.`);
    }
    if (side === "sell" && sizing === "shares" && quantityExceedsHolding(number, heldQuantity)) {
      return issue("size", `You hold ${heldQuantity} shares and cannot sell more than that.`);
    }
    const limit = toNumber(limitPrice);
    const stop = toNumber(stopPrice);
    if (orderType === "limit" && (limit === null || limit <= 0)) return issue("limit", "Enter a limit price.");
    if (orderType === "stop" && (stop === null || stop <= 0)) return issue("stop", "Enter a stop price.");
    const priceProblem = orderType === "limit" && limit !== null ? priceIssue(limit) : orderType === "stop" && stop !== null ? priceIssue(stop) : null;
    if (priceProblem) return issue(orderType === "limit" ? "limit" : "stop", priceProblem);
    if (protect) {
      const problem = protectionIssue(protect, protect === "limit" ? limit : stop, bought.limitPrice);
      if (problem) return issue(protect, problem);
    } else if (orderType === "stop" && stop !== null) {
      const problem = stopPriceIssue(side, stop, lastPrice, priceOf);
      if (problem) return issue("stop", problem);
    }
    return {
      request: {
        side,
        isin: security.isin,
        portfolioId,
        amount: sizing === "amount" ? number : null,
        shares: sizing === "shares" ? number : null,
        orderType,
        limitPrice: orderType === "limit" ? limit : null,
        stopPrice: orderType === "stop" ? stop : null,
        venue,
      },
      issue: null,
    };
  }, [security, size, sizing, side, orderType, limitPrice, stopPrice, venue, portfolioId, protect, bought.limitPrice, portfolio?.buyingPower, heldQuantity, lastPrice, orderMoney, priceOf]);
  const request = validation.request;
  // An issue is shown next to its field once the user has typed in it; an empty field just keeps the button disabled.
  const typed: Record<FormIssue["field"], boolean> = { security: true, size: size.trim() !== "", limit: limitPrice.trim() !== "", stop: stopPrice.trim() !== "" };
  const shownIssue = validation.issue && typed[validation.issue.field] ? validation.issue : null;
  const fieldIssue = (field: FormIssue["field"]) => (shownIssue?.field === field ? shownIssue.message : null);
  const limitHint = !protect && orderType === "limit" && request?.limitPrice != null ? limitPriceHint(side, request.limitPrice, lastPrice, priceOf) : null;

  // A failed preview describes the order as it was sent; once the form changes, the message no longer applies.
  useEffect(() => {
    if (failedPreview === null) return;
    setFailedPreview(null);
    setError(null);
  }, [security, size, sizing, side, orderType, limitPrice, stopPrice, venue, portfolioId]);

  async function runPreview() {
    setFailedPreview(null);
    if (request === null) {
      setError(validation.issue?.message ?? null);
      return;
    }
    const attemptedPortfolio = portfolios.find((item) => item.portfolioId === request.portfolioId);
    const failedRequest: FailedPreview = {
      request,
      securityName: security?.name ?? request.isin,
      portfolioName: attemptedPortfolio?.name ?? "Unknown portfolio",
      portfolioCurrency: attemptedPortfolio?.currency ?? "",
      attemptedAt: new Date().toLocaleString(),
    };
    const response = await flow.runPreview(() => invokeCommand(invoke, "preview_order", { request }));
    if (response === null) setFailedPreview(failedRequest);
  }

  async function placeOrder() {
    if (request === null || !preview) return;
    setFailedPreview(null);
    await flow.runSubmit(
      (previewId) => invokeCommand(invoke, "submit_order", { previewId, request, acknowledgeWarning: allAccepted }),
      () => {
        if (request.side === "buy") {
          setProtectable(true);
          setBought({ quantity: request.shares, limitPrice: request.orderType === "limit" ? request.limitPrice : null });
        } else if (protect) {
          setPlacedLegs((legs) => [...legs, protect]);
        }
        onPlaced();
      },
    );
  }

  function startProtection(kind: ProtectionKind) {
    setFailedPreview(null);
    setProtect(kind);
    setSide("sell");
    setSizing("shares");
    setSize(bought.quantity !== null ? String(bought.quantity) : "");
    setOrderType(kind);
    setLimitPrice("");
    setStopPrice("");
    flow.reset();
  }

  function requestClose() {
    if (!busy) onClose();
  }

  // Escape and outside clicks go through Headless UI's Dialog; the review step can only be left with its buttons.
  const dialogClose = stage === "preview" ? () => undefined : stage === "placed" ? onClose : requestClose;

  const sideLabel = side === "buy" ? "Buy" : "Sell";
  const summary = request;
  const failedRequest = failedPreview?.request;
  const failureHint = error && failedPreview ? previewFailureHint(error) : null;

  return (
    <ModalFrame onClose={dialogClose}>
      <ModalTitle titleRef={titleRef}>{stage === "placed" ? "Order submitted" : stage === "preview" ? `Review ${side} order` : "New order"}</ModalTitle>
      <p className="sr-only" role="status" aria-live="polite">
        {stage === "placed" ? "Order submitted" : stage === "preview" ? `Review ${side} order before confirming` : "Enter order details"}
      </p>

      {error && <Alert>{error}</Alert>}
      {error && failedPreview && failedRequest && stage === "form" && (
        <>
          {failureHint && <p className="mb-3 text-sm text-ink-muted">{failureHint}</p>}
          <details className="mb-3.5 rounded-control border border-line bg-inset p-3 text-sm">
            <summary className="cursor-pointer font-semibold text-ink-heading">What was sent</summary>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt className="text-ink-muted">Tool</dt>
              <dd className="min-w-0 break-words text-right text-ink-body">preview_{failedRequest.side}_order</dd>
              <dt className="text-ink-muted">Security</dt>
              <dd className="min-w-0 break-words text-right text-ink-body">
                {failedPreview.securityName} ({failedRequest.isin})
              </dd>
              <dt className="text-ink-muted">Portfolio</dt>
              <dd className="min-w-0 break-words text-right text-ink-body">
                {failedPreview.portfolioName} ({failedRequest.portfolioId})
              </dd>
              <dt className="text-ink-muted">Size</dt>
              <dd className="min-w-0 break-words text-right text-ink-body">
                {failedRequest.amount !== null ? `${failedRequest.amount}${failedPreview.portfolioCurrency ? ` ${failedPreview.portfolioCurrency}` : ""} amount` : `${failedRequest.shares} shares`}
              </dd>
              <dt className="text-ink-muted">Order type</dt>
              <dd className="min-w-0 break-words text-right text-ink-body">{failedRequest.orderType}</dd>
              <dt className="text-ink-muted">Limit price</dt>
              <dd className="min-w-0 break-words text-right text-ink-body">{failedRequest.limitPrice ?? "Not set"}</dd>
              <dt className="text-ink-muted">Stop price</dt>
              <dd className="min-w-0 break-words text-right text-ink-body">{failedRequest.stopPrice ?? "Not set"}</dd>
              <dt className="text-ink-muted">Trading venue</dt>
              <dd className="min-w-0 break-words text-right text-ink-body">{VENUE_OPTIONS.find((item) => item.value === failedRequest.venue)?.label ?? failedRequest.venue}</dd>
              <dt className="text-ink-muted">Attempted</dt>
              <dd className="min-w-0 break-words text-right text-ink-body">{failedPreview.attemptedAt}</dd>
            </dl>
          </details>
        </>
      )}

      {stage === "form" && (
        <>
          {!protect && (
            <div className="mb-3.5 grid grid-cols-2 overflow-hidden rounded-control border border-line-strong" role="group" aria-label="Order side">
              <button type="button" className={cx(SIDE_BUTTON, side === "buy" ? "bg-buy text-on-accent" : "bg-inset text-ink-soft")} onClick={() => setSide("buy")} aria-pressed={side === "buy"}>
                Buy
              </button>
              <button
                type="button"
                className={cx(SIDE_BUTTON, side === "sell" ? "bg-sell text-white" : "bg-inset text-ink-soft")}
                onClick={() => {
                  setSide("sell");
                  setSizing("shares");
                }}
                aria-pressed={side === "sell"}
              >
                Sell
              </button>
            </div>
          )}

          {protect ? (
            <p className={NOTE}>
              Sell {security?.name ?? "your shares"} to {protect === "limit" ? "take profit" : "limit a loss"}. Use the number of shares you bought. The buy must have been filled, or Scalable will not
              accept the sell order.
            </p>
          ) : (
            <SecurityPicker
              security={security}
              onChange={(nextSecurity) => {
                setFailedPreview(null);
                setSecurity(nextSecurity);
              }}
              invoke={invoke}
              parseSearch={parseSearch}
              onError={(message) => {
                setFailedPreview(null);
                setError(message);
              }}
            />
          )}

          {!protect && portfolios.length > 1 && (
            <Field className={field.label}>
              <Label>Portfolio</Label>
              <Select value={portfolioId} onChange={setPortfolioId} options={portfolios.map((item) => ({ value: item.portfolioId, label: item.name }))} />
            </Field>
          )}

          <div className={cx("grid items-start gap-3", protect ? "grid-cols-1" : "grid-cols-2")}>
            <Field className={field.label}>
              <Label>Order size</Label>
              {/* minmax(0, …) lets the input shrink below its intrinsic width, so the unit select stays inside this half of the row. */}
              <div className="grid grid-cols-[minmax(0,1fr)_7.3333rem] gap-2">
                <GroupInput
                  inputMode="decimal"
                  value={size}
                  onChange={(event) => setSize(event.currentTarget.value)}
                  placeholder={sizing === "amount" ? "0.00" : "0"}
                  invalid={fieldIssue("size") !== null}
                />
                <Select
                  label="Size unit"
                  value={sizing}
                  onChange={setSizing}
                  options={[
                    { value: "amount" as const, label: orderCurrency ?? "Amount" },
                    { value: "shares" as const, label: "Shares" },
                  ]}
                />
              </div>
              {fieldIssue("size") && (
                <Description className={field.error} role="alert">
                  {fieldIssue("size")}
                </Description>
              )}
            </Field>
            {!protect && (
              <Field className={field.label}>
                <Label>Order type</Label>
                <Select
                  value={orderType}
                  onChange={setOrderType}
                  options={[
                    { value: "market" as const, label: "Market" },
                    { value: "limit" as const, label: "Limit" },
                    { value: "stop" as const, label: "Stop" },
                  ]}
                />
              </Field>
            )}
          </div>

          {orderType === "limit" && (
            <Field className={field.label}>
              <Label>{protect ? PROTECTION_LEGS[0].priceLabel : "Limit price"}</Label>
              <GroupInput inputMode="decimal" suffix={currency} value={limitPrice} onChange={(event) => setLimitPrice(event.currentTarget.value)} invalid={fieldIssue("limit") !== null} />
              {fieldIssue("limit") && (
                <Description className={field.error} role="alert">
                  {fieldIssue("limit")}
                </Description>
              )}
              {!fieldIssue("limit") && limitHint && <Description className={field.hint}>{limitHint}</Description>}
            </Field>
          )}
          {orderType === "stop" && (
            <Field className={field.label}>
              <Label>{protect ? PROTECTION_LEGS[1].priceLabel : "Stop price"}</Label>
              <GroupInput inputMode="decimal" suffix={currency} value={stopPrice} onChange={(event) => setStopPrice(event.currentTarget.value)} invalid={fieldIssue("stop") !== null} />
              {fieldIssue("stop") && (
                <Description className={field.error} role="alert">
                  {fieldIssue("stop")}
                </Description>
              )}
            </Field>
          )}

          <Field className={field.label}>
            <Label>Trading venue</Label>
            <Select value={venue} onChange={setVenue} options={VENUE_OPTIONS} />
          </Field>

          <div className="mb-2 flex min-h-[1.2rem] flex-wrap gap-x-3 text-ink-soft">
            {side === "buy" && portfolio?.buyingPower != null && <span>Buying power {orderMoney(portfolio.buyingPower)}</span>}
            {side === "sell" && heldQuantity !== null && (
              <span>
                You hold {heldQuantity} shares{" "}
                <button
                  type="button"
                  className={btn.link}
                  onClick={() => {
                    setSizing("shares");
                    setSize(String(heldQuantity));
                  }}
                >
                  Sell all
                </button>
              </span>
            )}
            {lastPrice !== null && <span>Last price {priceOf(lastPrice)}</span>}
          </div>
          <p className={NOTE}>Nothing is sent to your broker yet. You will review the full order preview and confirm it in the next step.</p>
          <DialogFooter>
            <button
              className={btn.secondary}
              type="button"
              onClick={
                protect
                  ? () => {
                      flow.setStage("complete");
                      setError(null);
                    }
                  : requestClose
              }
              disabled={busy}
            >
              Cancel
            </button>
            <button className={side === "buy" ? btn.primary : btn.danger} type="button" onClick={() => void runPreview()} disabled={busy || request === null}>
              {busy ? "Preparing…" : `Preview ${side} order`}
            </button>
          </DialogFooter>
        </>
      )}

      {stage === "preview" && summary && security && preview && (
        <>
          <div
            className={cx(
              "mb-3.5 grid gap-[0.2rem] rounded-control border border-l-4 border-y-line-strong border-r-line-strong bg-inset p-3 text-ink-body [&_small]:text-[1em] [&_small]:text-ink-muted [&_strong]:text-ink-heading",
              side === "buy" ? "border-l-buy" : "border-l-sell",
            )}
          >
            <strong>
              {sideLabel} {security.name}
            </strong>
            <span>
              {summary.amount !== null ? orderMoney(summary.amount) : `${summary.shares} shares`} · {summary.orderType}
              {summary.limitPrice !== null && ` @ ${formatMoney(summary.limitPrice, currency)}`}
              {summary.stopPrice !== null && ` stop ${formatMoney(summary.stopPrice, currency)}`}
            </span>
            <small>
              {security.isin}
              {portfolio ? ` · ${portfolio.name}` : ""}
              {` · ${VENUE_OPTIONS.find((item) => item.value === venue)?.label ?? venue}`}
            </small>
          </div>
          <PreviewReviewBody review={review} accepted={accepted} onAccepted={setAccepted} expired={expiry.expired} expiryLabel={expiry.label} />
          {showDiagnostics && (
            <details className="mb-3.5 text-ink-muted [&_pre]:max-h-48 [&_pre]:overflow-auto [&_pre]:rounded-control [&_pre]:bg-inset [&_pre]:p-2 [&_pre]:whitespace-pre-wrap">
              <summary>Raw preview from Scalable</summary>
              <pre>{JSON.stringify(preview.preview, null, 2)}</pre>
            </details>
          )}
          <p className={NOTE}>Placing this order is final once submitted. The preview expires after 5 minutes.</p>
          <DialogFooter>
            {review.blocked && review.handoffUrl && (
              <button className={btn.secondary} type="button" onClick={() => void openUrl(review.handoffUrl ?? "").catch(() => undefined)}>
                Continue in Scalable ↗
              </button>
            )}
            <button
              className={btn.secondary}
              type="button"
              onClick={() => {
                flow.backToForm();
                setError(null);
              }}
              disabled={busy}
            >
              Back
            </button>
            <span className="mr-auto min-w-0 self-center text-left text-sm text-ink-muted">
              {sideLabel} {security.name} · {summary.amount !== null ? orderMoney(summary.amount) : `${summary.shares} shares`} · {summary.orderType} order
            </span>
            <button className={side === "buy" ? btn.primary : btn.danger} type="button" onClick={() => void placeOrder()} disabled={busy || expiry.expired || review.blocked || !allAccepted}>
              {busy ? "Submitting…" : `Confirm and place ${side} order`}
            </button>
          </DialogFooter>
        </>
      )}

      {stage === "placed" && (
        <>
          <p className={NOTE}>Scalable accepted the request. Check your transactions for the final order status.</p>
          <dl className={LINES}>
            {payloadLines(result).map((line, index) => (
              <div key={`${line.label}-${index}`}>
                <dt>{line.label}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
          </dl>
          {protectable && (
            <div className="mb-3.5 border-t border-line pt-3">
              <strong className="text-ink-heading">Protect this position (optional)</strong>
              <p className={NOTE}>
                Scalable has no combined take profit or stop loss. Each one is a separate sell order that you preview and confirm, and it can only be placed once the shares are in your portfolio.
                Scalable may refuse the second order if the first one already reserves the same shares.
              </p>
              <div className="flex flex-wrap gap-2">
                {PROTECTION_LEGS.map((leg) => (
                  <button key={leg.kind} className={btn.secondary} type="button" disabled={placedLegs.includes(leg.kind)} onClick={() => startProtection(leg.kind)}>
                    {placedLegs.includes(leg.kind) ? `${leg.label} placed` : `Set ${leg.label.toLowerCase()}`}
                  </button>
                ))}
                {extension.orderProtection && (
                  <extension.orderProtection.Actions
                    invoke={invoke}
                    security={security}
                    portfolioId={portfolioId}
                    quantity={bought.quantity !== null ? String(bought.quantity) : ""}
                    portfolios={portfolios}
                    held={security && heldQuantity ? [{ portfolioId, isin: security.isin, name: security.name, symbol: security.symbol, currency: security.currency, quantity: heldQuantity }] : []}
                  />
                )}
              </div>
              {extension.orderProtection && <p className={`mt-2 ${MODAL_TEXT}`}>{extension.orderProtection.note}</p>}
            </div>
          )}
          <DialogFooter>
            <button className={btn.secondary} type="button" autoFocus onClick={onClose}>
              Close
            </button>
          </DialogFooter>
        </>
      )}
    </ModalFrame>
  );
}
