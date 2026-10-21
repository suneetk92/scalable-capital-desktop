export const LOCALE = "en-GB";

const DASH = "—";

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatNumber(value: number | null, maximumFractionDigits = 2, minimumFractionDigits = 0) {
  if (value === null || !Number.isFinite(value)) return DASH;
  return new Intl.NumberFormat(LOCALE, { minimumFractionDigits, maximumFractionDigits }).format(value);
}

export function formatSignedMoney(value: number | null, currency = "EUR") {
  return value !== null && value > 0 ? `+${formatMoney(value, currency)}` : formatMoney(value, currency);
}

/** For the few cases that need their own number options (compact notation, significant digits); throws on a bad currency code. */
export function formatWithOptions(value: number, options: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(LOCALE, options).format(value);
}

export function formatMoney(value: number | null, currency = "EUR") {
  if (value === null || !Number.isFinite(value)) return DASH;
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function formatPercent(value: number | null, maximumFractionDigits = 2, minimumFractionDigits = 0) {
  if (value === null || !Number.isFinite(value)) return DASH;
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumber(value, maximumFractionDigits, minimumFractionDigits)}%`;
}

export function formatDate(value: Date | string | number | null, options?: Intl.DateTimeFormatOptions) {
  if (value === null || value === "") return DASH;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return DASH;
  const calendarDate = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat(LOCALE, { ...(options ?? { dateStyle: "medium" }), ...(calendarDate ? { timeZone: "UTC" } : {}) }).format(date);
}

/** Formats an instant in the local time zone and includes its short zone name. */
export function formatDateTime(value: Date | string | number | null, timeZone?: string) {
  if (value === null || value === "") return DASH;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return DASH;
  return new Intl.DateTimeFormat(LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

function normalizeGroupedInteger(value: string, separator: string): string | null {
  if (!value.includes(separator)) return /^\d+$/.test(value) ? value : null;
  const groups = value.split(separator);
  if (!groups[0] || groups[0].length > 3 || !/^\d+$/.test(groups[0])) return null;
  if (groups.slice(1).some((group) => group.length !== 3 || !/^\d+$/.test(group))) return null;
  return groups.join("");
}

/** Parses decimal input with either comma or dot decimals and optional correctly grouped thousands. */
export function parseDecimal(input: string): number | null {
  let text = input
    .trim()
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(/−/g, "-");
  if (!text) return null;
  let sign = "";
  if (text[0] === "+" || text[0] === "-") {
    sign = text[0] ?? "";
    text = text.slice(1);
  }
  if (!text || !/^[\d.,]+$/.test(text)) return null;

  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  let normalized: string;
  if (comma >= 0 && dot >= 0) {
    const decimalSeparator = comma > dot ? "," : ".";
    const groupingSeparator = decimalSeparator === "," ? "." : ",";
    const decimalIndex = Math.max(comma, dot);
    const integer = normalizeGroupedInteger(text.slice(0, decimalIndex), groupingSeparator);
    const fraction = text.slice(decimalIndex + 1);
    if (integer === null || !/^\d+$/.test(fraction)) return null;
    normalized = `${integer}.${fraction}`;
  } else {
    const separator = comma >= 0 ? "," : dot >= 0 ? "." : null;
    if (separator === null) {
      normalized = /^\d+$/.test(text) ? text : "";
    } else {
      const parts = text.split(separator);
      if (parts.length > 2) {
        const integer = normalizeGroupedInteger(text, separator);
        normalized = integer ?? "";
      } else {
        const [integerPart = "", fraction = ""] = parts;
        if (!/^\d*$/.test(integerPart) || !/^\d*$/.test(fraction) || (integerPart === "" && fraction === "")) return null;
        normalized = `${integerPart || "0"}.${fraction || "0"}`;
      }
    }
  }
  const parsed = Number(`${sign}${normalized}`);
  return normalized !== "" && Number.isFinite(parsed) ? parsed : null;
}
