/**
 * Pure payroll engine. Everything configurable comes in through `PolicyRules`; nothing about
 * rates or day bases is hard-coded. Fully unit-tested in tests/payroll-engine.test.ts.
 */
import { D, Decimal, roundMoney, type RoundingModeName } from "@/lib/money";

export type SalaryBasisName = "WORKING_DAYS" | "CALENDAR_DAYS" | "FIXED_DIVISOR";
export type LatePenaltyModeName = "NONE" | "LATES_TO_ABSENT" | "FIXED_AMOUNT" | "FRACTION_OF_DAY";

export interface PolicyRules {
  salaryBasis: SalaryBasisName;
  fixedDivisor: number | null;
  countHolidaysAsPaid: boolean;
  countWeeklyOffAsPaid: boolean;
  absentDeductionDays: Decimal.Value;
  halfDayDeductionDays: Decimal.Value;
  unpaidLeaveDeductionDays: Decimal.Value;
  latePenaltyMode: LatePenaltyModeName;
  latesPerAbsent: number | null;
  latePenaltyAmount: Decimal.Value | null;
  latePenaltyDayFraction: Decimal.Value | null;
  lateGraceCount: number;
  prorateNewJoiners: boolean;
  roundingMode: RoundingModeName;
  roundingPrecision: number;
  currency: string;
}

export interface ComponentInput {
  name: string;
  kind: "BONUS" | "DEDUCTION"; // BONUS = earning
  amount: Decimal.Value;
  isProrated: boolean;
}

export interface AdjustmentInput {
  kind: "BONUS" | "DEDUCTION";
  category: string;
  amount: Decimal.Value;
  description?: string | null;
}

export interface PayslipInput {
  baseSalary: Decimal.Value;
  components: ComponentInput[];
  adjustments: AdjustmentInput[];
  calendarDays: number; // days in month
  scheduledDays: number; // days in month that are not weekly offs (per employee schedule)
  weeklyOffDays: number;
  holidayDays: number; // holidays falling on scheduled days
  presentDays: number;
  lateDays: number;
  halfDays: number;
  absentDays: number;
  paidLeaveDays: Decimal.Value;
  unpaidLeaveDays: Decimal.Value;
  /** Scheduled working days in the month on which the employee was not employed (before join / after termination). */
  notEmployedScheduledDays: number;
  /** Calendar days in the month on which the employee was not employed. */
  notEmployedCalendarDays: number;
}

export interface BreakdownLine {
  key: string;
  label: string;
  kind: "EARNING" | "DEDUCTION" | "INFO";
  quantity?: string;
  rate?: string;
  amount: string; // 2dp string, positive
  detail?: string;
}

export interface PayslipResult {
  divisor: number;
  perDayRate: Decimal;
  payableDays: Decimal;
  baseEarned: Decimal;
  componentsEarned: Decimal;
  componentsDeducted: Decimal;
  attendanceDeduction: Decimal;
  lateDeduction: Decimal;
  bonusesTotal: Decimal;
  deductionsTotal: Decimal;
  grossPay: Decimal;
  netPay: Decimal;
  lines: BreakdownLine[];
  rulesApplied: string[];
}

const two = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function resolveDivisor(policy: PolicyRules, input: PayslipInput): number {
  switch (policy.salaryBasis) {
    case "CALENDAR_DAYS":
      return input.calendarDays;
    case "FIXED_DIVISOR":
      if (!policy.fixedDivisor || policy.fixedDivisor <= 0) throw new Error("Policy uses FIXED_DIVISOR but fixedDivisor is not set");
      return policy.fixedDivisor;
    case "WORKING_DAYS":
    default:
      return input.scheduledDays;
  }
}

export function computePayslip(policy: PolicyRules, input: PayslipInput): PayslipResult {
  const base = D(input.baseSalary);
  const lines: BreakdownLine[] = [];
  const rules: string[] = [];

  const divisor = resolveDivisor(policy, input);
  const perDayRate = divisor > 0 ? base.div(divisor) : new Decimal(0);
  rules.push(`Per-day rate = base salary ÷ ${divisor} (${policy.salaryBasis.replace("_", " ").toLowerCase()})`);
  lines.push({ key: "base", label: "Base salary", kind: "EARNING", amount: two(base).toFixed(2) });
  lines.push({ key: "rate", label: "Per-day rate", kind: "INFO", quantity: String(divisor), amount: perDayRate.toDecimalPlaces(2).toFixed(2), detail: `${divisor} days` });

  // ── Attendance-based deductions (all in "days") ────────────────────────────
  let deductionDays = new Decimal(0);
  const addDayDeduction = (key: string, label: string, days: Decimal, factor: Decimal.Value) => {
    const d = days.mul(factor);
    if (d.lte(0)) return;
    deductionDays = deductionDays.plus(d);
    const amt = two(d.mul(perDayRate));
    lines.push({ key, label, kind: "DEDUCTION", quantity: days.toString(), rate: `${D(factor).toString()} day`, amount: amt.toFixed(2) });
  };

  addDayDeduction("absent", "Absent days", D(input.absentDays), policy.absentDeductionDays);
  addDayDeduction("half_day", "Half days", D(input.halfDays), policy.halfDayDeductionDays);
  addDayDeduction("unpaid_leave", "Unpaid leave", D(input.unpaidLeaveDays), policy.unpaidLeaveDeductionDays);

  if (!policy.countHolidaysAsPaid && input.holidayDays > 0) {
    addDayDeduction("holiday_unpaid", "Holidays (unpaid per policy)", D(input.holidayDays), 1);
    rules.push("Holidays are unpaid");
  } else if (input.holidayDays > 0) {
    rules.push("Holidays are paid");
  }
  if (!policy.countWeeklyOffAsPaid && policy.salaryBasis === "CALENDAR_DAYS" && input.weeklyOffDays > 0) {
    addDayDeduction("weekly_off_unpaid", "Weekly offs (unpaid per policy)", D(input.weeklyOffDays), 1);
    rules.push("Weekly offs are unpaid");
  }

  if (policy.prorateNewJoiners) {
    const notEmployed = policy.salaryBasis === "WORKING_DAYS" ? input.notEmployedScheduledDays : input.notEmployedCalendarDays;
    if (notEmployed > 0) {
      addDayDeduction("not_employed", "Days not employed (pro-rata)", D(notEmployed), 1);
      rules.push("Salary pro-rated for partial month of employment");
    }
  }
  const attendanceDeduction = two(deductionDays.mul(perDayRate));

  // ── Late penalty ──────────────────────────────────────────────────────────
  const effectiveLates = Math.max(0, input.lateDays - policy.lateGraceCount);
  let lateDeduction = new Decimal(0);
  switch (policy.latePenaltyMode) {
    case "LATES_TO_ABSENT": {
      const per = policy.latesPerAbsent ?? 0;
      if (per > 0 && effectiveLates > 0) {
        const absents = Math.floor(effectiveLates / per);
        if (absents > 0) {
          lateDeduction = two(perDayRate.mul(absents));
          lines.push({ key: "late", label: `Late arrivals (${per} lates = 1 absent)`, kind: "DEDUCTION", quantity: String(effectiveLates), rate: `${absents} day`, amount: lateDeduction.toFixed(2) });
        }
        rules.push(`${per} late arrivals count as one absent day${policy.lateGraceCount ? ` (first ${policy.lateGraceCount} lates ignored)` : ""}`);
      }
      break;
    }
    case "FIXED_AMOUNT": {
      const amt = D(policy.latePenaltyAmount);
      if (effectiveLates > 0 && amt.gt(0)) {
        lateDeduction = two(amt.mul(effectiveLates));
        lines.push({ key: "late", label: "Late arrivals (fixed penalty)", kind: "DEDUCTION", quantity: String(effectiveLates), rate: amt.toFixed(2), amount: lateDeduction.toFixed(2) });
      }
      rules.push(`Fixed penalty of ${amt.toFixed(2)} per late arrival`);
      break;
    }
    case "FRACTION_OF_DAY": {
      const frac = D(policy.latePenaltyDayFraction);
      if (effectiveLates > 0 && frac.gt(0)) {
        lateDeduction = two(perDayRate.mul(frac).mul(effectiveLates));
        lines.push({ key: "late", label: "Late arrivals (fraction of day)", kind: "DEDUCTION", quantity: String(effectiveLates), rate: `${frac.toString()} day`, amount: lateDeduction.toFixed(2) });
      }
      rules.push(`Each late arrival deducts ${frac.toString()} of a day`);
      break;
    }
    case "NONE":
    default:
      rules.push("No late penalty");
  }

  const baseEarned = Decimal.max(new Decimal(0), two(base.minus(attendanceDeduction).minus(lateDeduction)));
  const payableDays = Decimal.max(new Decimal(0), new Decimal(divisor).minus(deductionDays));

  // ── Recurring components ──────────────────────────────────────────────────
  const prorationFactor = divisor > 0 ? payableDays.div(divisor) : new Decimal(1);
  let componentsEarned = new Decimal(0);
  let componentsDeducted = new Decimal(0);
  for (const c of input.components) {
    const full = D(c.amount);
    const amt = two(c.isProrated ? full.mul(prorationFactor) : full);
    if (amt.lte(0)) continue;
    if (c.kind === "BONUS") {
      componentsEarned = componentsEarned.plus(amt);
      lines.push({ key: `comp:${c.name}`, label: c.name, kind: "EARNING", amount: amt.toFixed(2), detail: c.isProrated ? "pro-rated" : undefined });
    } else {
      componentsDeducted = componentsDeducted.plus(amt);
      lines.push({ key: `comp:${c.name}`, label: c.name, kind: "DEDUCTION", amount: amt.toFixed(2), detail: c.isProrated ? "pro-rated" : undefined });
    }
  }

  // ── Ad-hoc adjustments ────────────────────────────────────────────────────
  let bonusesTotal = new Decimal(0);
  let deductionsTotal = new Decimal(0);
  for (const a of input.adjustments) {
    const amt = two(D(a.amount));
    if (amt.lte(0)) continue;
    if (a.kind === "BONUS") {
      bonusesTotal = bonusesTotal.plus(amt);
      lines.push({ key: `adj:${a.category}`, label: a.category, kind: "EARNING", amount: amt.toFixed(2), detail: a.description ?? undefined });
    } else {
      deductionsTotal = deductionsTotal.plus(amt);
      lines.push({ key: `adj:${a.category}`, label: a.category, kind: "DEDUCTION", amount: amt.toFixed(2), detail: a.description ?? undefined });
    }
  }

  const grossPay = roundMoney(baseEarned.plus(componentsEarned).plus(bonusesTotal), policy.roundingPrecision, policy.roundingMode);
  const netPay = Decimal.max(
    new Decimal(0),
    roundMoney(grossPay.minus(componentsDeducted).minus(deductionsTotal), policy.roundingPrecision, policy.roundingMode),
  );
  rules.push(`Rounded ${policy.roundingMode.replace("_", " ").toLowerCase()} to ${policy.roundingPrecision} decimal places`);

  return {
    divisor,
    perDayRate: perDayRate.toDecimalPlaces(4),
    payableDays: payableDays.toDecimalPlaces(2),
    baseEarned,
    componentsEarned,
    componentsDeducted,
    attendanceDeduction,
    lateDeduction,
    bonusesTotal,
    deductionsTotal,
    grossPay,
    netPay,
    lines,
    rulesApplied: rules,
  };
}
