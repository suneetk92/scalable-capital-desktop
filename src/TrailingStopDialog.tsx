import { Description, Field, Label } from "@headlessui/react";
import { useState } from "react";
import { CheckboxField, GroupInput, Select } from "./controls";
import type { SecurityHit } from "./OrderDialog";
import { formatNumber } from "./screener";
import { invokeCommand } from "./commands";
import { type Invoke } from "./tools";
import { decimal, trailIssue, type TrailKind } from "./trailing";
import type { HeldPosition, PagePortfolio } from "./types";
import { Alert, btn, field, DialogFooter, ModalFrame, ModalTitle, MODAL_TEXT } from "./ui";
import { useBusyAction } from "./hooks/usePreviewFlow";

type Props = {
  security: SecurityHit | null;
  portfolioId: string;
  quantity: string;
  portfolios: PagePortfolio[];
  /** The securities that can be chosen: the ones held, with their shares. */
  held: HeldPosition[];
  invoke: Invoke;
  tradingEnabled: boolean;
  onClose: () => void;
  onAdded?: () => void;
};

/**
 * Starts a trailing stop loss. Scalable has no such order, so the app watches the price itself and
 * sells at market, without a further confirmation: the tick in this form is that confirmation.
 */
export function TrailingStopDialog({ security: initial, portfolioId: initialPortfolio, quantity: initialQuantity, portfolios, held, invoke, tradingEnabled, onClose, onAdded }: Props) {
  const [security, setSecurity] = useState<SecurityHit | null>(initial);
  const [portfolioId, setPortfolioIdState] = useState(initialPortfolio || portfolios[0]?.portfolioId || "");
  const setPortfolioId = (id: string) => {
    setPortfolioIdState(id);
    setSecurity((current) => (current && held.some((item) => item.portfolioId === id && item.isin === current.isin) ? current : null));
  };
  const [quantity, setQuantity] = useState(initialQuantity);
  const [kind, setKind] = useState<TrailKind>("percent");
  const [distance, setDistance] = useState("");
  const [understood, setUnderstood] = useState(false);
  const action = useBusyAction();
  const { busy, error } = action;

  const heldHere = held.filter((item) => item.portfolioId === portfolioId);
  const holding = security ? heldHere.find((item) => item.isin === security.isin) : undefined;
  const heldQuantity = holding?.quantity ?? null;
  const currency = security?.currency ?? "EUR";
  const quantityNumber = decimal(quantity);
  const distanceNumber = decimal(distance);
  const quantityProblem =
    quantityNumber === null || quantityNumber <= 0
      ? "Enter a number of shares greater than zero."
      : heldQuantity !== null && quantityNumber > heldQuantity
        ? `You hold only ${formatNumber(heldQuantity)} shares.`
        : null;
  const distanceProblem = trailIssue(kind, distanceNumber);
  const issue = !security || !holding ? "Choose a security you hold." : (quantityProblem ?? distanceProblem);
  // Shown under the field once something is typed there; an empty field only keeps the button disabled.
  const shownQuantityProblem = quantity.trim() !== "" ? quantityProblem : null;
  const shownDistanceProblem = distance.trim() !== "" ? distanceProblem : null;

  async function start() {
    if (issue || !security || quantityNumber === null || distanceNumber === null) return;
    await action.run(
      () => {
        // The command's request field is named `shares`.
        return invokeCommand(invoke, "add_trailing_stop", { request: { isin: security.isin, name: security.name, portfolioId, shares: quantityNumber, trail: { kind, value: distanceNumber } } });
      },
      () => {
        onAdded?.();
        onClose();
      },
    );
  }

  return (
    <ModalFrame
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <ModalTitle>New trailing stop loss</ModalTitle>
      <p className={`mb-4 ${MODAL_TEXT}`}>
        Scalable has no trailing stop. The app follows the price instead: it remembers the highest price from now on and sells at market when the price falls by the distance you set below that high.
      </p>
      {error && <Alert>{error}</Alert>}
      {!tradingEnabled && <Alert>Turn on Trading to start a trailing stop.</Alert>}

      {portfolios.length > 1 && (
        <Field className={field.label}>
          <Label>Portfolio</Label>
          <Select value={portfolioId} onChange={setPortfolioId} options={portfolios.map((item) => ({ value: item.portfolioId, label: item.name }))} />
        </Field>
      )}

      <Field className={field.label}>
        <Label>Security</Label>
        <Select
          value={holding?.isin ?? ""}
          onChange={(isin) => {
            const next = heldHere.find((item) => item.isin === isin);
            setSecurity(next ? { isin: next.isin, name: next.name, symbol: next.symbol, currency: next.currency } : null);
          }}
          options={heldHere.map((item) => ({ value: item.isin, label: `${item.name} · ${item.isin}` }))}
          placeholder={heldHere.length === 0 ? "No securities held" : "Choose a security you hold"}
          disabled={heldHere.length === 0}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field className={field.label}>
          <Label>Shares to sell</Label>
          <GroupInput inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.currentTarget.value)} placeholder="0" invalid={shownQuantityProblem !== null} />
          {heldQuantity !== null && (
            <Description className={field.hint}>
              You hold {formatNumber(heldQuantity)} shares{" "}
              <button type="button" className={btn.link} onClick={() => setQuantity(String(heldQuantity))}>
                Sell all
              </button>
            </Description>
          )}
          {shownQuantityProblem && (
            <Description className={field.error} role="alert">
              {shownQuantityProblem}
            </Description>
          )}
        </Field>
        <Field className={field.label}>
          <Label>Distance below the high</Label>
          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
            <GroupInput inputMode="decimal" value={distance} onChange={(event) => setDistance(event.currentTarget.value)} placeholder="0" invalid={shownDistanceProblem !== null} />
            <Select
              label="Distance unit"
              value={kind}
              onChange={setKind}
              options={[
                { value: "percent" as const, label: "%" },
                { value: "amount" as const, label: currency },
              ]}
            />
          </div>
          {shownDistanceProblem && (
            <Description className={field.error} role="alert">
              {shownDistanceProblem}
            </Description>
          )}
        </Field>
      </div>

      <div className={`mb-3 ${field.note}`}>
        The sale only happens while this app is running and signed in with Trading on, and the price is checked at the frequency set in Settings (every 30 seconds by default). It can miss a fast drop,
        a closed market or a price gap, and it sells at the market price, which can be lower than the trigger. If Scalable asks for a warning to be accepted, the app does not sell: it tells you
        instead. Quit the app and nothing is watched.
      </div>
      <CheckboxField checked={understood} onChange={setUnderstood}>
        I understand that the app will sell these shares at market without asking again.
      </CheckboxField>

      <DialogFooter className="mt-4">
        <button className={btn.secondary} type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className={btn.danger} type="button" onClick={() => void start()} disabled={busy || !tradingEnabled || !understood || issue !== null}>
          {busy ? "Starting…" : "Start trailing stop"}
        </button>
      </DialogFooter>
    </ModalFrame>
  );
}
