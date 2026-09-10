/**
 * Pure attendance-window logic. No database access; fully unit-tested in tests/window.test.ts.
 *
 * Terminology
 * - "working day" / attendance date: the calendar date (company/schedule timezone) on which a
 *   shift STARTS. A night shift 20:00–05:00 that starts on 11 Sep belongs to 11 Sep even when the
 *   employee checks in at 01:00 on 12 Sep.
 * - window: [opensAt, closesAt) around the shift start during which self check-in is allowed.
 */
import type { AttendanceStatus } from "@prisma/client";
import { addDays, isoWeekday, localMinutesToInstant, type Ymd } from "@/lib/dates";

export interface ScheduleRules {
  timezone: string;
  shiftStartMin: number;
  shiftEndMin: number;
  workingDays: number[]; // ISO weekdays 1..7
  checkinOpensMinBefore: number;
  lateAfterMin: number;
  halfDayAfterMin: number;
  checkinClosesAfterMin: number;
}

export interface WindowOverride {
  checkinOpensMinBefore?: number | null;
  lateAfterMin?: number | null;
  halfDayAfterMin?: number | null;
  checkinClosesAfterMin?: number | null;
}

export interface DayWindow {
  ymd: Ymd;
  opensAt: Date;
  shiftStartAt: Date;
  shiftEndAt: Date;
  lateAfterAt: Date;
  halfDayAfterAt: Date;
  closesAt: Date;
  crossesMidnight: boolean;
}

export type DayType = "WORKING" | "WEEKLY_OFF" | "HOLIDAY";

export function applyOverride(rules: ScheduleRules, o?: WindowOverride | null): ScheduleRules {
  if (!o) return rules;
  return {
    ...rules,
    checkinOpensMinBefore: o.checkinOpensMinBefore ?? rules.checkinOpensMinBefore,
    lateAfterMin: o.lateAfterMin ?? rules.lateAfterMin,
    halfDayAfterMin: o.halfDayAfterMin ?? rules.halfDayAfterMin,
    checkinClosesAfterMin: o.checkinClosesAfterMin ?? rules.checkinClosesAfterMin,
  };
}

export function dayType(rules: Pick<ScheduleRules, "workingDays">, ymd: Ymd, holidays: ReadonlySet<Ymd>): DayType {
  if (holidays.has(ymd)) return "HOLIDAY";
  if (!rules.workingDays.includes(isoWeekday(ymd))) return "WEEKLY_OFF";
  return "WORKING";
}

export function windowFor(rules: ScheduleRules, ymd: Ymd): DayWindow {
  const shiftStartAt = localMinutesToInstant(ymd, rules.shiftStartMin, rules.timezone);
  const crossesMidnight = rules.shiftEndMin <= rules.shiftStartMin;
  const shiftEndAt = localMinutesToInstant(ymd, rules.shiftEndMin + (crossesMidnight ? 1440 : 0), rules.timezone);
  const ms = (m: number) => new Date(shiftStartAt.getTime() + m * 60_000);
  return {
    ymd,
    opensAt: ms(-rules.checkinOpensMinBefore),
    shiftStartAt,
    shiftEndAt,
    lateAfterAt: ms(rules.lateAfterMin),
    halfDayAfterAt: ms(rules.halfDayAfterMin),
    closesAt: ms(rules.checkinClosesAfterMin),
    crossesMidnight,
  };
}

/**
 * Which working day's window (if any) contains `now`?
 * Checks yesterday, today and tomorrow in the schedule's timezone; windows never overlap because
 * checkinOpensMinBefore + checkinClosesAfterMin <= 1440 is enforced on save.
 */
export function resolveOpenWindow(
  rules: ScheduleRules,
  now: Date,
  todayYmd: Ymd,
  overrideFor: (ymd: Ymd) => WindowOverride | null | undefined = () => null,
): DayWindow | null {
  for (const ymd of [addDays(todayYmd, -1), todayYmd, addDays(todayYmd, 1)]) {
    const w = windowFor(applyOverride(rules, overrideFor(ymd)), ymd);
    if (now >= w.opensAt && now < w.closesAt) return w;
  }
  return null;
}

/** The next window that opens after `now` (for "attendance opens at …" messaging). */
export function nextWindow(rules: ScheduleRules, now: Date, todayYmd: Ymd, holidays: ReadonlySet<Ymd>, lookaheadDays = 14): DayWindow | null {
  for (let i = -1; i <= lookaheadDays; i++) {
    const ymd = addDays(todayYmd, i);
    if (dayType(rules, ymd, holidays) !== "WORKING") continue;
    const w = windowFor(rules, ymd);
    if (w.opensAt > now) return w;
  }
  return null;
}

export type CheckInStatus = Extract<AttendanceStatus, "PRESENT" | "LATE" | "HALF_DAY">;

export function classifyCheckIn(w: DayWindow, at: Date): { status: CheckInStatus; minutesLate: number } {
  const minutesLate = Math.max(0, Math.floor((at.getTime() - w.shiftStartAt.getTime()) / 60_000));
  if (at <= w.lateAfterAt) return { status: "PRESENT", minutesLate };
  if (at <= w.halfDayAfterAt) return { status: "LATE", minutesLate };
  return { status: "HALF_DAY", minutesLate };
}

export function validateRules(r: ScheduleRules): string[] {
  const errs: string[] = [];
  if (r.shiftStartMin < 0 || r.shiftStartMin > 1439) errs.push("Shift start must be a valid time");
  if (r.shiftEndMin < 0 || r.shiftEndMin > 1439) errs.push("Shift end must be a valid time");
  if (r.checkinOpensMinBefore < 0) errs.push("Check-in opening offset must be ≥ 0");
  if (!(r.lateAfterMin <= r.halfDayAfterMin && r.halfDayAfterMin <= r.checkinClosesAfterMin))
    errs.push("Thresholds must satisfy late ≤ half day ≤ window close");
  if (r.checkinOpensMinBefore + r.checkinClosesAfterMin > 1440) errs.push("The check-in window may not exceed 24 hours");
  if (r.workingDays.length === 0) errs.push("At least one working day is required");
  if (r.workingDays.some((d) => d < 1 || d > 7)) errs.push("Working days must be ISO weekdays 1–7");
  return errs;
}
