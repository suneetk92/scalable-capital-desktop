import { decimalNumber as num, isRec, parseMaybeJson, recordsOf, stringsOf as strings, type Rec } from "./response";

/** What `get_savings_plan_config` allows for one security. */
export type PlanConfig = {
  min: number | null;
  max: number | null;
  frequencies: string[];
  paymentMethods: string[];
  dynamizationRates: string[];
  schedules: { dayOfMonth: number; availableYearMonths: string[] }[];
  defaults: { frequency: string; dayOfMonth: string; yearMonth: string; dynamizationRate: string; paymentMethod: string };
};

/** The values the user edits, all as text. */
export type PlanForm = { amount: string; frequency: string; dayOfMonth: string; yearMonth: string; dynamizationRate: string; paymentMethod: string };

/** What the backend's `preview_savings_plan` command takes. */
type PlanRequest = {
  isin: string;
  portfolioId: string | null;
  amount: number;
  frequency: string | null;
  dayOfMonth: number | null;
  yearMonth: string | null;
  dynamizationRate: string | null;
  paymentMethod: string | null;
};

/** One entry of `list_savings_plans`: `{ kind, instrument: { identifier, name }, amount, configuration }`. */
export type ExistingPlan = {
  isin: string | null;
  name: string;
  amount: string;
  frequency: string;
  dayOfMonth: string;
  dynamizationRate: string;
  paymentMethod: string;
};

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

const str = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");

export function parsePlanConfig(payload: unknown): PlanConfig | null {
  const config = parseMaybeJson(payload);
  if (!isRec(config)) return null;
  const limits = isRec(config.amountLimits) ? config.amountLimits : {};
  const defaults = isRec(config.defaults) ? config.defaults : {};
  const schedules = recordsOf(config.schedules).flatMap((schedule) => {
    const day = num(schedule.dayOfMonth);
    return day === null ? [] : [{ dayOfMonth: day, availableYearMonths: strings(schedule.availableYearMonths) }];
  });
  return {
    min: num(limits.min),
    max: num(limits.max),
    frequencies: strings(config.frequencies),
    paymentMethods: strings(config.paymentMethods),
    dynamizationRates: strings(config.dynamizationRates),
    schedules,
    defaults: {
      frequency: str(defaults.frequency),
      dayOfMonth: str(defaults.dayOfMonth),
      yearMonth: str(defaults.yearMonth),
      dynamizationRate: str(defaults.dynamizationRate),
      paymentMethod: str(defaults.paymentMethod),
    },
  };
}

/** The first execution months that go with a day of the month. */
export function monthsFor(config: PlanConfig, dayOfMonth: string): string[] {
  const day = num(dayOfMonth);
  return config.schedules.find((schedule) => schedule.dayOfMonth === day)?.availableYearMonths ?? [];
}

/** Starting values: Scalable's defaults, overridden by the plan being edited. */
export function initialPlanForm(config: PlanConfig, existing: ExistingPlan | null): PlanForm {
  const { defaults } = config;
  const pick = (own: string, fallback: string, options: string[]) => (own !== "" && (options.length === 0 || options.includes(own)) ? own : fallback);
  const dayOfMonth = existing && existing.dayOfMonth !== "" && config.schedules.some((schedule) => schedule.dayOfMonth === num(existing.dayOfMonth)) ? existing.dayOfMonth : defaults.dayOfMonth;
  const months = monthsFor(config, dayOfMonth);
  return {
    amount: existing?.amount ?? "",
    frequency: pick(existing?.frequency ?? "", defaults.frequency, config.frequencies),
    dayOfMonth,
    yearMonth: months.includes(defaults.yearMonth) ? defaults.yearMonth : (months[0] ?? defaults.yearMonth),
    dynamizationRate: pick(existing?.dynamizationRate ?? "", defaults.dynamizationRate, config.dynamizationRates),
    paymentMethod: pick(existing?.paymentMethod ?? "", defaults.paymentMethod, config.paymentMethods),
  };
}

/** The request for the preview, or the reason it cannot be sent yet. Empty fields are left out, so Scalable's defaults apply. */
export function planRequest(isin: string, portfolioId: string, form: PlanForm, config: PlanConfig | null): PlanRequest | string {
  if (!ISIN.test(isin)) return "Choose a security first.";
  const amount = num(form.amount);
  if (amount === null || amount <= 0) return "Enter an amount greater than zero.";
  if (config?.min != null && amount < config.min) return `The smallest amount for this security is ${config.min}.`;
  if (config?.max != null && amount > config.max) return `The largest amount for this security is ${config.max}.`;
  const day = form.dayOfMonth.trim() === "" ? null : num(form.dayOfMonth);
  if (form.dayOfMonth.trim() !== "" && (day === null || !Number.isInteger(day) || day < 1 || day > 31)) return "Choose a day of the month between 1 and 31.";
  const text = (value: string) => (value.trim() === "" ? null : value.trim());
  return {
    isin,
    portfolioId: portfolioId === "" ? null : portfolioId,
    amount,
    frequency: text(form.frequency),
    dayOfMonth: day,
    yearMonth: text(form.yearMonth),
    dynamizationRate: text(form.dynamizationRate),
    paymentMethod: text(form.paymentMethod),
  };
}

export type PlanDialogState = { existing: ExistingPlan | null; portfolioId: string };

export type PlanFilter = { text: string; frequency: string };

export const NO_PLAN_FILTER: PlanFilter = { text: "", frequency: "" };

export function isPlanFiltering(filter: PlanFilter) {
  return filter.text.trim() !== "" || filter.frequency !== "";
}

/** Whether a plan record passes the filter: `text` matches the symbol (ISIN) or name. */
export function matchesPlan(record: Rec, filter: PlanFilter): boolean {
  const plan = planOf(record);
  const text = filter.text.trim().toLowerCase();
  if (text !== "") {
    const identifier = isRec(record.instrument) ? str(record.instrument.identifier) : "";
    if (![plan.isin ?? identifier, plan.name].some((value) => value.toLowerCase().includes(text))) return false;
  }
  return filter.frequency === "" || plan.frequency === filter.frequency;
}

/** A plan from `list_savings_plans`, read the way the published output schema lays it out. */
export function planOf(record: Rec): ExistingPlan {
  const instrument = isRec(record.instrument) ? record.instrument : {};
  const configuration = isRec(record.configuration) ? record.configuration : {};
  const identifier = str(instrument.identifier);
  return {
    isin: record.kind === "crypto" || !ISIN.test(identifier) ? null : identifier,
    name: str(instrument.name) || identifier,
    amount: str(record.amount),
    frequency: str(configuration.frequency),
    dayOfMonth: str(configuration.dayOfMonth),
    dynamizationRate: str(configuration.dynamizationRate),
    paymentMethod: str(configuration.paymentMethod),
  };
}
