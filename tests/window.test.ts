import { describe, expect, it } from "vitest";
import { classifyCheckIn, dayType, nextWindow, resolveOpenWindow, validateRules, windowFor, type ScheduleRules } from "@/server/services/attendance/window";

const day: ScheduleRules = {
  timezone: "Asia/Karachi",
  shiftStartMin: 9 * 60,
  shiftEndMin: 18 * 60,
  workingDays: [1, 2, 3, 4, 5],
  checkinOpensMinBefore: 60,
  lateAfterMin: 15,
  halfDayAfterMin: 240,
  checkinClosesAfterMin: 480,
};

const night: ScheduleRules = { ...day, shiftStartMin: 20 * 60, shiftEndMin: 5 * 60, workingDays: [1, 2, 3, 4, 5, 6] };

const pkt = (s: string) => new Date(`${s}+05:00`);

describe("windowFor", () => {
  it("computes a day-shift window in PKT", () => {
    const w = windowFor(day, "2026-09-10");
    expect(w.opensAt.toISOString()).toBe(pkt("2026-09-10T08:00:00").toISOString());
    expect(w.shiftStartAt.toISOString()).toBe(pkt("2026-09-10T09:00:00").toISOString());
    expect(w.lateAfterAt.toISOString()).toBe(pkt("2026-09-10T09:15:00").toISOString());
    expect(w.halfDayAfterAt.toISOString()).toBe(pkt("2026-09-10T13:00:00").toISOString());
    expect(w.closesAt.toISOString()).toBe(pkt("2026-09-10T17:00:00").toISOString());
    expect(w.crossesMidnight).toBe(false);
  });

  it("handles a night shift crossing midnight", () => {
    const w = windowFor(night, "2026-09-11");
    expect(w.crossesMidnight).toBe(true);
    expect(w.shiftStartAt.toISOString()).toBe(pkt("2026-09-11T20:00:00").toISOString());
    expect(w.shiftEndAt.toISOString()).toBe(pkt("2026-09-12T05:00:00").toISOString());
    expect(w.closesAt.toISOString()).toBe(pkt("2026-09-12T04:00:00").toISOString());
  });
});

describe("resolveOpenWindow", () => {
  it("returns today's window during the day shift", () => {
    const w = resolveOpenWindow(day, pkt("2026-09-10T09:05:00"), "2026-09-10");
    expect(w?.ymd).toBe("2026-09-10");
  });

  it("returns null outside any window", () => {
    expect(resolveOpenWindow(day, pkt("2026-09-10T18:30:00"), "2026-09-10")).toBeNull();
    expect(resolveOpenWindow(day, pkt("2026-09-10T07:59:59"), "2026-09-10")).toBeNull();
  });

  it("attributes an after-midnight check-in to the previous day's night shift", () => {
    // 01:30 on 12 Sep — today's date in PKT is 2026-09-12, but the open window belongs to 11 Sep.
    const w = resolveOpenWindow(night, pkt("2026-09-12T01:30:00"), "2026-09-12");
    expect(w?.ymd).toBe("2026-09-11");
    expect(classifyCheckIn(w!, pkt("2026-09-12T01:30:00"))).toEqual({ status: "HALF_DAY", minutesLate: 330 });
  });

  it("applies per-date overrides", () => {
    const w = resolveOpenWindow(day, pkt("2026-09-10T07:30:00"), "2026-09-10", (ymd) =>
      ymd === "2026-09-10" ? { checkinOpensMinBefore: 120 } : null,
    );
    expect(w?.ymd).toBe("2026-09-10");
  });
});

describe("classifyCheckIn", () => {
  const w = windowFor(day, "2026-09-10");
  it("PRESENT within grace", () => {
    expect(classifyCheckIn(w, pkt("2026-09-10T08:45:00"))).toEqual({ status: "PRESENT", minutesLate: 0 });
    expect(classifyCheckIn(w, pkt("2026-09-10T09:15:00"))).toEqual({ status: "PRESENT", minutesLate: 15 });
  });
  it("LATE after grace", () => {
    expect(classifyCheckIn(w, pkt("2026-09-10T09:16:00"))).toEqual({ status: "LATE", minutesLate: 16 });
    expect(classifyCheckIn(w, pkt("2026-09-10T13:00:00"))).toEqual({ status: "LATE", minutesLate: 240 });
  });
  it("HALF_DAY after half-day threshold", () => {
    expect(classifyCheckIn(w, pkt("2026-09-10T13:01:00"))).toEqual({ status: "HALF_DAY", minutesLate: 241 });
  });
});

describe("dayType / nextWindow", () => {
  const holidays = new Set(["2026-09-11"]);
  it("classifies weekly offs and holidays", () => {
    expect(dayType(day, "2026-09-12", holidays)).toBe("WEEKLY_OFF"); // Saturday
    expect(dayType(day, "2026-09-11", holidays)).toBe("HOLIDAY");
    expect(dayType(day, "2026-09-10", holidays)).toBe("WORKING");
  });
  it("finds the next working window skipping holiday and weekend", () => {
    const w = nextWindow(day, pkt("2026-09-10T18:00:00"), "2026-09-10", holidays);
    expect(w?.ymd).toBe("2026-09-14"); // Monday
  });
});

describe("validateRules", () => {
  it("rejects a window longer than 24h and bad thresholds", () => {
    expect(validateRules({ ...day, checkinOpensMinBefore: 1000, checkinClosesAfterMin: 500 })).toContain("The check-in window may not exceed 24 hours");
    expect(validateRules({ ...day, lateAfterMin: 300 })).toContain("Thresholds must satisfy late ≤ half day ≤ window close");
    expect(validateRules(day)).toEqual([]);
  });
});
