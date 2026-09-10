import { describe, expect, it } from "vitest";
import { computePayslip, type PayslipInput, type PolicyRules } from "@/server/services/payroll/engine";

const policy: PolicyRules = {
  salaryBasis: "WORKING_DAYS",
  fixedDivisor: null,
  countHolidaysAsPaid: true,
  countWeeklyOffAsPaid: true,
  absentDeductionDays: "1",
  halfDayDeductionDays: "0.5",
  unpaidLeaveDeductionDays: "1",
  latePenaltyMode: "LATES_TO_ABSENT",
  latesPerAbsent: 3,
  latePenaltyAmount: null,
  latePenaltyDayFraction: null,
  lateGraceCount: 0,
  prorateNewJoiners: true,
  roundingMode: "HALF_UP",
  roundingPrecision: 0,
  currency: "PKR",
};

// September 2026: 30 days, Mon–Fri schedule => 22 scheduled days, 8 weekly offs.
const base: PayslipInput = {
  baseSalary: "66000",
  components: [],
  adjustments: [],
  calendarDays: 30,
  scheduledDays: 22,
  weeklyOffDays: 8,
  holidayDays: 0,
  presentDays: 22,
  lateDays: 0,
  halfDays: 0,
  absentDays: 0,
  paidLeaveDays: 0,
  unpaidLeaveDays: 0,
  notEmployedScheduledDays: 0,
  notEmployedCalendarDays: 0,
};

describe("computePayslip — working days basis", () => {
  it("pays full salary for perfect attendance", () => {
    const r = computePayslip(policy, base);
    expect(r.divisor).toBe(22);
    expect(r.perDayRate.toString()).toBe("3000");
    expect(r.netPay.toString()).toBe("66000");
    expect(r.grossPay.toString()).toBe("66000");
  });

  it("deducts absents, half days and unpaid leave by configured fractions", () => {
    const r = computePayslip(policy, { ...base, presentDays: 17, absentDays: 2, halfDays: 2, unpaidLeaveDays: 1 });
    // 2×1 + 2×0.5 + 1×1 = 4 days × 3000 = 12000
    expect(r.attendanceDeduction.toString()).toBe("12000");
    expect(r.netPay.toString()).toBe("54000");
    expect(r.payableDays.toString()).toBe("18");
  });

  it("converts lates to absents (3 lates = 1 absent), honouring grace count", () => {
    const r = computePayslip(policy, { ...base, presentDays: 15, lateDays: 7 });
    expect(r.lateDeduction.toString()).toBe("6000"); // floor(7/3)=2 days
    const g = computePayslip({ ...policy, lateGraceCount: 2 }, { ...base, presentDays: 15, lateDays: 7 });
    expect(g.lateDeduction.toString()).toBe("3000"); // (7-2)=5 → 1 day
  });

  it("supports fixed-amount and fraction-of-day late penalties", () => {
    const f = computePayslip({ ...policy, latePenaltyMode: "FIXED_AMOUNT", latePenaltyAmount: "500" }, { ...base, lateDays: 4 });
    expect(f.lateDeduction.toString()).toBe("2000");
    const d = computePayslip({ ...policy, latePenaltyMode: "FRACTION_OF_DAY", latePenaltyDayFraction: "0.25" }, { ...base, lateDays: 4 });
    expect(d.lateDeduction.toString()).toBe("3000"); // 4 × 0.25 × 3000
    const n = computePayslip({ ...policy, latePenaltyMode: "NONE" }, { ...base, lateDays: 10 });
    expect(n.lateDeduction.toString()).toBe("0");
  });

  it("pro-rates a mid-month joiner on scheduled days", () => {
    const r = computePayslip(policy, { ...base, presentDays: 12, notEmployedScheduledDays: 10, notEmployedCalendarDays: 14 });
    expect(r.attendanceDeduction.toString()).toBe("30000");
    expect(r.netPay.toString()).toBe("36000");
    const np = computePayslip({ ...policy, prorateNewJoiners: false }, { ...base, presentDays: 12, notEmployedScheduledDays: 10, notEmployedCalendarDays: 14 });
    expect(np.netPay.toString()).toBe("66000");
  });

  it("treats holidays as unpaid when configured", () => {
    const r = computePayslip({ ...policy, countHolidaysAsPaid: false }, { ...base, presentDays: 21, holidayDays: 1 });
    expect(r.netPay.toString()).toBe("63000");
    const p = computePayslip(policy, { ...base, presentDays: 21, holidayDays: 1 });
    expect(p.netPay.toString()).toBe("66000");
  });

  it("applies components (pro-rated or fixed) and ad-hoc adjustments", () => {
    const r = computePayslip(policy, {
      ...base,
      presentDays: 20,
      absentDays: 2,
      components: [
        { name: "Medical allowance", kind: "BONUS", amount: "5000", isProrated: false },
        { name: "Fuel allowance", kind: "BONUS", amount: "2200", isProrated: true },
        { name: "Provident fund", kind: "DEDUCTION", amount: "3000", isProrated: false },
      ],
      adjustments: [
        { kind: "BONUS", category: "Performance bonus", amount: "10000" },
        { kind: "DEDUCTION", category: "Advance recovery", amount: "4000" },
      ],
    });
    // base earned 60000; fuel prorated 2200×20/22 = 2000; gross = 60000+5000+2000+10000 = 77000
    expect(r.baseEarned.toString()).toBe("60000");
    expect(r.componentsEarned.toString()).toBe("7000");
    expect(r.grossPay.toString()).toBe("77000");
    expect(r.netPay.toString()).toBe("70000");
  });

  it("never goes below zero", () => {
    const r = computePayslip(policy, { ...base, presentDays: 0, absentDays: 22, adjustments: [{ kind: "DEDUCTION", category: "Fine", amount: "1000" }] });
    expect(r.baseEarned.toString()).toBe("0");
    expect(r.netPay.toString()).toBe("0");
  });

  it("handles a month with zero scheduled days", () => {
    const r = computePayslip(policy, { ...base, scheduledDays: 0, presentDays: 0, weeklyOffDays: 30 });
    expect(r.perDayRate.toString()).toBe("0");
    expect(r.netPay.toString()).toBe("66000");
  });
});

describe("computePayslip — other bases and rounding", () => {
  it("calendar days basis", () => {
    const r = computePayslip({ ...policy, salaryBasis: "CALENDAR_DAYS" }, { ...base, baseSalary: "60000", presentDays: 21, absentDays: 1 });
    expect(r.divisor).toBe(30);
    expect(r.perDayRate.toString()).toBe("2000");
    expect(r.netPay.toString()).toBe("58000");
  });

  it("calendar days basis with unpaid weekly offs", () => {
    const r = computePayslip({ ...policy, salaryBasis: "CALENDAR_DAYS", countWeeklyOffAsPaid: false }, { ...base, baseSalary: "60000" });
    expect(r.netPay.toString()).toBe("44000"); // 8 offs × 2000
  });

  it("fixed divisor basis", () => {
    const r = computePayslip({ ...policy, salaryBasis: "FIXED_DIVISOR", fixedDivisor: 26 }, { ...base, baseSalary: "52000", presentDays: 21, absentDays: 1 });
    expect(r.perDayRate.toString()).toBe("2000");
    expect(r.netPay.toString()).toBe("50000");
  });

  it("uses calendar-day proration for non working-day bases", () => {
    const r = computePayslip({ ...policy, salaryBasis: "CALENDAR_DAYS" }, { ...base, baseSalary: "60000", presentDays: 12, notEmployedScheduledDays: 10, notEmployedCalendarDays: 15 });
    expect(r.netPay.toString()).toBe("30000");
  });

  it("throws when FIXED_DIVISOR has no divisor", () => {
    expect(() => computePayslip({ ...policy, salaryBasis: "FIXED_DIVISOR", fixedDivisor: null }, base)).toThrow();
  });

  it("rounds per policy", () => {
    const input = { ...base, baseSalary: "50000", scheduledDays: 21, presentDays: 20, absentDays: 1 }; // rate 2380.952…
    expect(computePayslip(policy, input).netPay.toString()).toBe("47619");
    expect(computePayslip({ ...policy, roundingMode: "FLOOR" }, input).netPay.toString()).toBe("47619");
    expect(computePayslip({ ...policy, roundingMode: "CEIL" }, input).netPay.toString()).toBe("47620");
    expect(computePayslip({ ...policy, roundingPrecision: 2 }, input).netPay.toString()).toBe("47619.05");
  });
});
