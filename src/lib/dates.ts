/**
 * Calendar-date helpers.
 *
 * Throughout the server code a calendar date ("working day", "effective from", ...) is a
 * `Ymd` string such as "2026-09-10". Prisma maps PostgreSQL DATE columns to JS Dates at UTC
 * midnight; the two converters below are the only place that translation happens.
 * Instants (check-in time, created_at) are real Dates and are formatted in the company
 * timezone for display.
 */
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { addDays as dfAddDays, differenceInCalendarDays, getDaysInMonth, parseISO } from "date-fns";

export type Ymd = string; // YYYY-MM-DD

export const DEFAULT_TZ = "Asia/Karachi";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(s: unknown): s is Ymd {
  return typeof s === "string" && YMD_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** Ymd -> Date suitable for a Prisma @db.Date column. */
export function ymdToDb(ymd: Ymd): Date {
  if (!isYmd(ymd)) throw new Error(`Invalid Ymd: ${ymd}`);
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Prisma @db.Date value -> Ymd. */
export function dbToYmd(d: Date): Ymd {
  return d.toISOString().slice(0, 10);
}

/** Today's calendar date in the given timezone. */
export function todayYmd(tz: string = DEFAULT_TZ, now: Date = new Date()): Ymd {
  return formatInTimeZone(now, tz, "yyyy-MM-dd");
}

export function addDays(ymd: Ymd, n: number): Ymd {
  return dbToYmd(dfAddDays(ymdToDb(ymd), n));
}

export function daysBetweenInclusive(from: Ymd, to: Ymd): number {
  return differenceInCalendarDays(ymdToDb(to), ymdToDb(from)) + 1;
}

export function compareYmd(a: Ymd, b: Ymd): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxYmd(a: Ymd, b: Ymd): Ymd {
  return a > b ? a : b;
}
export function minYmd(a: Ymd, b: Ymd): Ymd {
  return a < b ? a : b;
}

/** ISO weekday 1 = Monday ... 7 = Sunday. */
export function isoWeekday(ymd: Ymd): number {
  const d = ymdToDb(ymd).getUTCDay(); // 0 = Sunday
  return d === 0 ? 7 : d;
}

export function monthRange(year: number, month: number): { start: Ymd; end: Ymd; days: number } {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const days = getDaysInMonth(new Date(Date.UTC(year, month - 1, 1)));
  const end = `${year}-${String(month).padStart(2, "0")}-${String(days).padStart(2, "0")}`;
  return { start, end, days };
}

export function* eachDay(from: Ymd, to: Ymd): Generator<Ymd> {
  let cur = from;
  while (cur <= to) {
    yield cur;
    cur = addDays(cur, 1);
  }
}

export function ymdParts(ymd: Ymd): { year: number; month: number; day: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { year: y, month: m, day: d };
}

/** Local wall-clock (midnight of `ymd` + `minutes`) in `tz` -> absolute instant. */
export function localMinutesToInstant(ymd: Ymd, minutes: number, tz: string): Date {
  const midnight = fromZonedTime(`${ymd}T00:00:00`, tz);
  return new Date(midnight.getTime() + minutes * 60_000);
}

export function formatInstant(d: Date | null | undefined, tz: string = DEFAULT_TZ, fmt = "dd MMM yyyy, hh:mm a"): string {
  if (!d) return "—";
  return formatInTimeZone(d, tz, fmt);
}

export function formatTimeOfDay(d: Date | null | undefined, tz: string = DEFAULT_TZ): string {
  if (!d) return "—";
  return formatInTimeZone(d, tz, "hh:mm a");
}

export function formatYmd(ymd: Ymd | Date | null | undefined, fmt = "dd MMM yyyy"): string {
  if (!ymd) return "—";
  const d = typeof ymd === "string" ? ymdToDb(ymd) : ymd;
  return formatInTimeZone(d, "UTC", fmt);
}

export function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function minutesToLabel(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function hhmmToMinutes(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Invalid time: ${s}`);
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) throw new Error(`Invalid time: ${s}`);
  return h * 60 + mi;
}

export function monthLabel(year: number, month: number): string {
  return formatInTimeZone(new Date(Date.UTC(year, month - 1, 1)), "UTC", "MMMM yyyy");
}

export function currentYearMonth(tz: string = DEFAULT_TZ, now = new Date()): { year: number; month: number } {
  const { year, month } = ymdParts(todayYmd(tz, now));
  return { year, month };
}

export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export { toZonedTime, fromZonedTime, formatInTimeZone, parseISO };
