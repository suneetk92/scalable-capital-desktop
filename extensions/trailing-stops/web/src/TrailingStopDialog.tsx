import { Description, Field, Label } from "@headlessui/react";
import { useState } from "react";
import { CheckboxField, GroupInput, Select } from "../../../../src/controls";
import { HeldSecurityPicker } from "../../../../src/HeldSecurityPicker";
import type { SecurityHit } from "../../../../src/OrderDialog";
import { SecurityPicker } from "../../../../src/SecurityPicker";
import { formatNumber, parseSearch } from "../../../../src/screener";
import { invokeCommand } from "./commands";
import { type Invoke } from "../../../../src/tools";
import { decimal, trailIssue, type TrailingStop, type TrailKind, type TrailSide } from "./trailing";
import type { HeldPosition, PagePortfolio } from "../../../../src/types";
import { Alert, btn, field, DialogFooter, ModalFrame, ModalTitle, MODAL_TEXT } from "../../../../src/ui";
import { useBusyAction } from "../../../../src/hooks/usePreviewFlow";

type Props = {
  /** A stop loss sells shares of a holding; a buy stop buys any security for an amount of money. Defaults to a stop loss. */
  side?: TrailSide;
  security: SecurityHit | null;
  portfolioId: string;
  quantity: string;
  portfolios: PagePortfolio[];
  /** The securities that can be chosen: the ones held, with their shares. */
  held: HeldPosition[];
  invoke: Invoke;
  /** Restricted access or more: starting or changing a stop places no order, the watcher needs Full access to act. */
  manageEnabled: boolean;
  onClose: () => void;
  onAdded?: () => void;
  /** A stop that is watching: the dialog changes its shares and distance instead of starting a new one. */
  editing?: TrailingStop;
};

/**
 * Starts, or with `editing` changes, a trailing stop loss or buy stop. Scalable has no such order, so the app watches the price itself and
 * trades at market, without a further confirmation: the tick in this form is that confirmation.
 */
export function TrailingStopDialog({
  side: requestedSide = "sell",
  security: initial,
  portfolioId: initialPortfolio,
  quantity: initialQuantity,
  portfolios,
  held,
  invoke,
  manageEnabled,
  onClose,
  onAdded,
  editing,
}: Props) {
  const side = editing?.side ?? requestedSide;
  const buying = side === "buy";
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [security, setSecurity] = useState<SecurityHit | null>(
    editing
      ? { isin: editing.isin, name: editing.name, symbol: "", currency: held.find((item) => item.portfolioId === editing.portfolioId && item.isin === editing.isin)?.currency ?? "EUR" }
      : initial,
  );
  const [portfolioId, setPortfolioIdState] = useState((editing ? editing.portfolioId : initialPortfolio) || portfolios[0]?.portfolioId || "");
  const setPortfolioId = (id: string) => {
    setPortfolioIdState(id);
    setSecurity((current) => (buying || (current && held.some((item) => item.portfolioId === id && item.isin === current.isin)) ? current : null));
  };
  const [quantity, setQuantity] = useState(editing ? String((buying ? editing.amount : editing.quantity) ?? "") : initialQuantity);
  const [kind, setKind] = useState<TrailKind>(editing?.trail.kind ?? "percent");
  const [distance, setDistance] = useState(editing ? String(editing.trail.value) : "");
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
      ? buying
        ? "Enter an amount greater than zero."
        : "Enter a number of shares greater than zero."
      : !buying && heldQuantity !== null && quantityNumber > heldQuantity
        ? `You hold only ${formatNumber(heldQuantity)} shares.`
        : null;
  const distanceProblem = trailIssue(kind, distanceNumber);
  const missingSecurity = buying ? !security : !security || !holding;
  const issue = missingSecurity ? (buying ? "Choose a security." : "Choose a security you hold.") : (quantityProblem ?? distanceProblem);
  // Shown under the field once something is typed there; an empty field only keeps the button disabled.
  const shownQuantityProblem = quantity.trim() !== "" ? quantityProblem : null;
  const shownDistanceProblem = distance.trim() !== "" ? distanceProblem : null;

  async function start() {
    if (issue || !security || quantityNumber === null || distanceNumber === null) return;
    await action.run(
      () => {
        const trail = { kind, value: distanceNumber };
        if (editing) return invokeCommand(invoke, "update_trailing_stop", { request: { id: editing.id, size: quantityNumber, trail } });
        // The command's request has `shares` for a sale and `amount` for a purchase.
        const size = buying ? { amount: quantityNumber } : { shares: quantityNumber };
        return invokeCommand(invoke, "add_trailing_stop", { request: { side, isin: security.isin, name: security.name, portfolioId, ...size, trail } });
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
      <ModalTitle>{`${editing ? "Edit" : "New"} ${buying ? "trailing buy stop" : "trailing stop loss"}`}</ModalTitle>
      <p className={`mb-4 ${MODAL_TEXT}`}>
        {editing
          ? editing.status === "attention"
            ? `Check in Scalable that nothing was ${buying ? "bought" : "sold"}. Saving starts watching again from the last price, with the ${buying ? "amount" : "shares"} and distance below.`
            : `The stop keeps the ${buying ? "lowest" : "highest"} price it has seen. The new ${buying ? "amount" : "shares"} and distance apply from the next price check.`
          : buying
            ? "Scalable has no trailing buy stop. The app follows the price instead: it remembers the lowest price from now on and buys at market when the price rises by the distance you set above that low."
            : "Scalable has no trailing stop. The app follows the price instead: it remembers the highest price from now on and sells at market when the price falls by the distance you set below that high."}
      </p>
      {(error ?? pickerError) && <Alert>{error ?? pickerError}</Alert>}
      {!manageEnabled && <Alert>Switch to Restricted or Full access to {editing ? "change" : "start"} a trailing stop.</Alert>}

      {!editing && portfolios.length > 1 && (
        <Field className={field.label}>
          <Label>Portfolio</Label>
          <Select value={portfolioId} onChange={setPortfolioId} options={portfolios.map((item) => ({ value: item.portfolioId, label: item.name }))} />
        </Field>
      )}

      {editing ? (
        <p className={`mb-3 ${MODAL_TEXT}`}>
          <strong className="font-semibold text-ink-strong">{editing.isin}</strong> · {editing.name}
        </p>
      ) : buying ? (
        <SecurityPicker security={security} onChange={setSecurity} invoke={invoke} parseSearch={parseSearch} onError={setPickerError} />
      ) : (
        <HeldSecurityPicker
          held={heldHere}
          selected={holding ?? null}
          onChange={(item) => setSecurity(item ? { isin: item.isin, name: item.name, symbol: item.symbol, currency: item.currency } : null)}
        />
      )}
      {!buying && heldQuantity !== null && (
        <p className={`mb-3 ${field.hint}`}>
          You hold {formatNumber(heldQuantity)} shares.{" "}
          <button type="button" className={btn.link} onClick={() => setQuantity(String(heldQuantity))}>
            Sell all
          </button>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field className={field.label}>
          <Label>{buying ? `Amount to spend (${currency})` : "Shares to sell"}</Label>
          <GroupInput inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.currentTarget.value)} placeholder="0" invalid={shownQuantityProblem !== null} />
          {shownQuantityProblem && (
            <Description className={field.error} role="alert">
              {shownQuantityProblem}
            </Description>
          )}
        </Field>
        <Field className={field.label}>
          <Label>{buying ? "Distance above the low" : "Distance below the high"}</Label>
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
        {buying
          ? "The purchase only happens while this app is running and signed in with Full access during exchange hours, and the price is checked at the frequency set in Settings (every 30 seconds by default). It can miss a fast rise, a closed market or a price gap, and it buys at the market price, which can be higher than the trigger. It needs enough cash in the portfolio when it triggers. If Scalable asks for a warning to be accepted, the app does not buy: it tells you instead. Quit the app and nothing is watched."
          : "The sale only happens while this app is running and signed in with Full access during exchange hours, and the price is checked at the frequency set in Settings (every 30 seconds by default). It can miss a fast drop, a closed market or a price gap, and it sells at the market price, which can be lower than the trigger. If Scalable asks for a warning to be accepted, the app does not sell: it tells you instead. Quit the app and nothing is watched."}
      </div>
      <CheckboxField checked={understood} onChange={setUnderstood}>
        {buying ? "I understand that the app will buy this security at market without asking again." : "I understand that the app will sell these shares at market without asking again."}
      </CheckboxField>

      <DialogFooter className="mt-4">
        <button className={btn.secondary} type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className={btn.danger} type="button" onClick={() => void start()} disabled={busy || !manageEnabled || !understood || issue !== null}>
          {busy
            ? editing
              ? "Saving…"
              : "Starting…"
            : editing
              ? editing.status === "attention"
                ? "Save and watch again"
                : "Save changes"
              : buying
                ? "Start trailing buy stop"
                : "Start trailing stop"}
        </button>
      </DialogFooter>
    </ModalFrame>
  );
}
