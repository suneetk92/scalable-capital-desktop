/**
 * Trading hours of the exchange (EIX, https://european-investor-exchange.com/de/handelszeiten):
 * Monday to Friday, 06:00 to 23:00 Europe/Berlin time, except on its trading calendar days: closed on
 * 1 January, Good Friday, Easter Monday, 1 May, 15 August, 3 October, 31 October, 1 November and
 * 24, 25, 26 and 31 December; from 07:30 on 6 January, Rosenmontag, Ascension, Whit Monday and
 * Corpus Christi; until 14:00 on 30 December. The Rust gate (`src-tauri/src/mcp/hours.rs`) enforces
 * the same hours; this only shows them.
 */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const OPENS = 6 * 60;
const LATE_OPENS = 7 * 60 + 30;
const CLOSES = 23 * 60;
const SHORT_CLOSES = 14 * 60;
const DAY = 86_400_000;

const berlin = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin",
  weekday: "short",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

/** Easter Sunday as a month (1-12) and day (anonymous Gregorian algorithm). */
function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function closedDay(year: number, month: number, day: number) {
  const fixed = [[1, 1], [5, 1], [8, 15], [10, 3], [10, 31], [11, 1], [12, 24], [12, 25], [12, 26], [12, 31]];
  if (fixed.some(([m, d]) => m === month && d === day)) return true;
  const easter = easterSunday(year);
  const sunday = Date.UTC(year, easter.month - 1, easter.day);
  const today = Date.UTC(year, month - 1, day);
  return today === sunday - 2 * DAY || today === sunday + DAY;
}

function opensAt(year: number, month: number, day: number) {
  const easter = easterSunday(year);
  const sunday = Date.UTC(year, easter.month - 1, easter.day);
  const today = Date.UTC(year, month - 1, day);
  const late = (month === 1 && day === 6) || [-48, 39, 50, 60].some((offset) => today === sunday + offset * DAY);
  return late ? LATE_OPENS : OPENS;
}

export function exchangeOpen(now: Date = new Date()) {
  const parts = Object.fromEntries(berlin.formatToParts(now).map((part) => [part.type, part.value]));
  const weekday = WEEKDAYS.indexOf(parts.weekday ?? "");
  if (weekday < 0 || weekday > 4) return false;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  if (closedDay(year, month, day)) return false;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const closes = month === 12 && day === 30 ? SHORT_CLOSES : CLOSES;
  return minute >= opensAt(year, month, day) && minute < closes;
}

export const EXCHANGE_HOURS_NOTE = "The exchange is closed: it trades Monday to Friday, 06:00 to 23:00 Berlin time, with some holidays closed or shortened. Trading stays off until it opens.";
