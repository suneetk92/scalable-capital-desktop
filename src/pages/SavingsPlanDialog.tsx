import { openUrl } from "@tauri-apps/plugin-opener";
import { Description, Field, Label } from "@headlessui/react";
import { useEffect, useMemo, useState } from "react";
import { GroupInput, Select } from "../controls";
import type { SecurityHit } from "../OrderDialog";
import { LINES, PreviewReviewBody } from "../PreviewReview";
import { initialPlanForm, monthsFor, parsePlanConfig, planRequest, type ExistingPlan, type PlanConfig, type PlanForm } from "../savingsPlan";
import { SecurityPicker } from "../SecurityPicker";
import { invokeCommand, TOOL } from "../commands";
import { callTools, humanize, type Invoke } from "../tools";
import { isRec } from "../response";
import type { PagePortfolio } from "../types";
import { Alert, btn, field, DialogFooter, ModalFrame, ModalTitle, MODAL_TEXT } from "../ui";
import { useAsyncQuery } from "../hooks/useAsyncQuery";
import { usePreviewFlow } from "../hooks/usePreviewFlow";

type Props = {
  /** The plan being changed, or null for a new one. */
  existing: ExistingPlan | null;
  portfolios: PagePortfolio[];
  portfolioId: string;
  invoke: Invoke;
  parseSearch: (payload: unknown) => SecurityHit[];
  tradingEnabled: boolean;
  onClose: () => void;
  onSaved: () => void;
};

const EMPTY_FORM: PlanForm = { amount: "", frequency: "", dayOfMonth: "", yearMonth: "", dynamizationRate: "", paymentMethod: "" };

const options = (values: string[], label: (value: string) => string = humanize) => values.map((value) => ({ value, label: label(value) }));

/**
 * Create or change a savings plan in two steps, like an order: the form is built from `get_savings_plan_config`
 * (amount limits, frequencies, execution days and months, payment methods), then `preview_savings_plan` shows
 * Scalable's own review with its costs, and only an explicit confirmation calls `submit_savings_plan`. Both
 * steps run in the backend, which refuses them while Trading is off.
 */
export function SavingsPlanDialog({ existing, portfolios, portfolioId: initialPortfolio, invoke, parseSearch, tradingEnabled, onClose, onSaved }: Props) {
  const [security, setSecurity] = useState<SecurityHit | null>(existing?.isin ? { isin: existing.isin, name: existing.name, symbol: "", currency: "EUR" } : null);
  const [portfolioId, setPortfolioId] = useState(initialPortfolio || portfolios[0]?.portfolioId || "");
  const [form, setForm] = useState<PlanForm>(EMPTY_FORM);
  const flow = usePreviewFlow();
  const stage = flow.stage === "complete" ? "saved" : flow.stage;
  const { preview, result, accepted, setAccepted, busy, error, setError, review, expiry, allAccepted } = flow;

  const isin = security?.isin ?? "";
  const configQuery = useAsyncQuery(
    async () => {
      const [outcome] = await callTools(invoke, [{ name: TOOL.getSavingsPlanConfig, arguments: { isin, ...(portfolioId ? { portfolioId } : {}) } }]);
      if (!outcome?.ok) throw new Error(outcome?.error ?? "Scalable's plan options could not be loaded.");
      const parsed = parsePlanConfig(outcome.result);
      if (!parsed) throw new Error("Scalable returned invalid plan options.");
      return parsed;
    },
    [isin, portfolioId, invoke],
    Boolean(isin),
  );
  const config: PlanConfig | null = configQuery.data;
  const configFailed = configQuery.error !== null;
  const loadingConfig = configQuery.loading;
  const note = configQuery.error ? `Scalable's plan options could not be loaded (${configQuery.error}). Try again before previewing.` : null;

  useEffect(() => {
    if (config) setForm(initialPlanForm(config, existing?.isin === isin ? existing : null));
    else if (configQuery.error) setForm({ ...EMPTY_FORM, amount: existing?.isin === isin ? existing.amount : "" });
  }, [config, configQuery.error, existing, isin]);

  const request = useMemo(() => planRequest(isin, portfolioId, form, config), [isin, portfolioId, form, config]);
  // The amount is the only free-text field, so a request problem belongs to it once something is typed there.
  const amountProblem = typeof request === "string" && security && form.amount.trim() !== "" ? request : null;
  const months = config ? monthsFor(config, form.dayOfMonth) : [];

  function set(change: Partial<PlanForm>) {
    setForm((current) => ({ ...current, ...change }));
  }

  function changeDay(dayOfMonth: string) {
    const available = config ? monthsFor(config, dayOfMonth) : [];
    set({ dayOfMonth, yearMonth: available.includes(form.yearMonth) ? form.yearMonth : (available[0] ?? "") });
  }

  async function runPreview() {
    if (typeof request === "string") {
      setError(request);
      return;
    }
    await flow.runPreview(() => invokeCommand(invoke, "preview_savings_plan", { request }));
  }

  async function savePlan() {
    if (typeof request === "string" || !preview) return;
    await flow.runSubmit((previewId) => invokeCommand(invoke, "submit_savings_plan", { previewId, request }), onSaved);
  }

  const requestClose = () => {
    if (!busy) onClose();
  };
  // The review step can only be left with its buttons.
  const dialogClose = stage === "preview" ? () => undefined : stage === "saved" ? onClose : requestClose;
  const summary = typeof request === "string" ? null : request;
  const savedPlan = isRec(result) && isRec(result.savingsPlan) ? result.savingsPlan : null;
  const nextExecution = savedPlan && isRec(savedPlan.configuration) && typeof savedPlan.configuration.nextExecutionDate === "string" ? savedPlan.configuration.nextExecutionDate : null;
  const refreshUnavailable = isRec(result) && isRec(result.outcome) && result.outcome.status === "refresh_unavailable";

  return (
    <ModalFrame onClose={dialogClose}>
      <ModalTitle>{stage === "saved" ? "Savings plan saved" : stage === "preview" ? "Review savings plan" : existing ? "Change savings plan" : "New savings plan"}</ModalTitle>
      {error && <Alert>{error}</Alert>}

      {stage === "form" && (
        <>
          <SecurityPicker security={security} onChange={setSecurity} invoke={invoke} parseSearch={parseSearch} onError={setError} />
          {portfolios.length > 1 && (
            <Field className={field.label}>
              <Label>Portfolio</Label>
              <Select value={portfolioId} onChange={setPortfolioId} options={portfolios.map((item) => ({ value: item.portfolioId, label: item.name }))} />
            </Field>
          )}
          {security && (
            <>
              <Field className={field.label}>
                <Label>Amount per execution</Label>
                <GroupInput inputMode="decimal" suffix="EUR" value={form.amount} onChange={(event) => set({ amount: event.currentTarget.value })} placeholder="0.00" invalid={amountProblem !== null} />
                {amountProblem && (
                  <Description className={field.error} role="alert">
                    {amountProblem}
                  </Description>
                )}
                {config && (config.min !== null || config.max !== null) && (
                  <Description className={field.hint}>{[config.min !== null ? `From ${config.min}` : "", config.max !== null ? `up to ${config.max}` : ""].filter(Boolean).join(" ")} EUR</Description>
                )}
              </Field>
              {loadingConfig && <small className={`${field.hint} mb-2 block`}>Loading Scalable's plan options…</small>}
              {config && (
                <div className="grid grid-cols-2 gap-3">
                  {config.frequencies.length > 0 && (
                    <Field className={field.label}>
                      <Label>Frequency</Label>
                      <Select value={form.frequency} onChange={(frequency) => set({ frequency })} options={options(config.frequencies)} />
                    </Field>
                  )}
                  {config.schedules.length > 0 && (
                    <Field className={field.label}>
                      <Label>Day of the month</Label>
                      <Select value={form.dayOfMonth} onChange={changeDay} options={config.schedules.map((schedule) => ({ value: String(schedule.dayOfMonth), label: String(schedule.dayOfMonth) }))} />
                    </Field>
                  )}
                  {months.length > 0 && (
                    <Field className={field.label}>
                      <Label>First execution month</Label>
                      <Select value={form.yearMonth} onChange={(yearMonth) => set({ yearMonth })} options={options(months, (month) => month)} />
                    </Field>
                  )}
                  {config.dynamizationRates.length > 0 && (
                    <Field className={field.label}>
                      <Label>Dynamization rate</Label>
                      <Select value={form.dynamizationRate} onChange={(dynamizationRate) => set({ dynamizationRate })} options={options(config.dynamizationRates, (rate) => rate)} />
                    </Field>
                  )}
                  {config.paymentMethods.length > 0 && (
                    <Field className={field.label}>
                      <Label>Payment method</Label>
                      <Select value={form.paymentMethod} onChange={(paymentMethod) => set({ paymentMethod })} options={options(config.paymentMethods)} />
                    </Field>
                  )}
                </div>
              )}
              {note && (
                <div className={`${field.note} mb-3 flex items-center justify-between gap-3`} role="note">
                  <span>{note}</span>
                  {configFailed && (
                    <button className={btn.link} type="button" onClick={configQuery.retry} disabled={loadingConfig}>
                      Try again
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {!tradingEnabled && <div className={`${field.note} mb-3`}>Turn on Trading (top right) to create or change savings plans.</div>}
          <p className={`mb-4 ${MODAL_TEXT}`}>Nothing is saved yet. You will review Scalable's preview with its costs and confirm it in the next step. A plan for the same security is updated.</p>
          <DialogFooter>
            <button className={btn.secondary} type="button" onClick={requestClose} disabled={busy}>
              Cancel
            </button>
            <button className={btn.primary} type="button" onClick={() => void runPreview()} disabled={busy || loadingConfig || configFailed || !tradingEnabled || typeof request === "string"}>
              {busy ? "Preparing…" : "Preview plan"}
            </button>
          </DialogFooter>
        </>
      )}

      {stage === "preview" && summary && security && (
        <>
          <div className="mb-3.5 grid gap-[0.2rem] rounded-control border border-l-4 border-y-line-strong border-r-line-strong border-l-buy bg-inset p-3 text-ink-body [&_small]:text-[1em] [&_small]:text-ink-muted [&_strong]:text-ink-heading">
            <strong>
              {summary.amount} EUR into {security.name}
            </strong>
            <span>
              {[summary.frequency ? humanize(summary.frequency) : "", summary.dayOfMonth ? `day ${summary.dayOfMonth}` : "", summary.yearMonth ? `from ${summary.yearMonth}` : ""]
                .filter(Boolean)
                .join(" · ") || "Scalable's default schedule"}
            </span>
            <small>{security.isin}</small>
          </div>
          <PreviewReviewBody review={review} accepted={accepted} onAccepted={setAccepted} expired={expiry.expired} expiryLabel={expiry.label} />
          <p className={`mb-4 ${MODAL_TEXT}`}>Scalable saves exactly this plan once you confirm. The preview expires after 5 minutes.</p>
          <DialogFooter>
            {review.handoffUrl && (
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
            <button className={btn.primary} type="button" onClick={() => void savePlan()} disabled={busy || expiry.expired || !allAccepted}>
              {busy ? "Saving…" : "Confirm and save plan"}
            </button>
          </DialogFooter>
        </>
      )}

      {stage === "saved" && (
        <>
          <p className={`mb-4 ${MODAL_TEXT}`}>{refreshUnavailable ? "Scalable saved the plan, but could not refresh the list yet. Reload the page in a moment." : "Scalable saved the plan."}</p>
          {(savedPlan || nextExecution) && (
            <dl className={LINES}>
              {savedPlan && typeof savedPlan.amount === "string" && (
                <div>
                  <dt>Amount</dt>
                  <dd>{savedPlan.amount} EUR</dd>
                </div>
              )}
              {nextExecution && (
                <div>
                  <dt>Next execution</dt>
                  <dd>{nextExecution}</dd>
                </div>
              )}
            </dl>
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
