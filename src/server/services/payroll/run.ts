import { Prisma, type PayrollPolicy } from "@prisma/client";
import { prisma, type Db } from "@/server/db";
import type { Actor } from "@/server/auth/actor";
import { assertAdmin, ownEmployeeId } from "@/server/auth/actor";
import { audit } from "@/server/services/audit";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { addDays, currentYearMonth, dbToYmd, eachDay, minYmd, monthRange, todayYmd, ymdToDb, type Ymd } from "@/lib/dates";
import { computePayslip, type AdjustmentInput, type PayslipInput, type PolicyRules } from "@/server/services/payroll/engine";
import { ensureFinalized } from "@/server/services/attendance";
import { dayType } from "@/server/services/attendance/window";
import { holidaySet, rulesOf, scheduleResolver } from "@/server/services/schedules";
import { currentSalary } from "@/server/services/employees";
import { getSettings } from "@/server/services/settings";
import { D } from "@/lib/money";

// ── Policies ─────────────────────────────────────────────────────────────────

export type PolicyInput = Omit<PolicyRules, "absentDeductionDays" | "halfDayDeductionDays" | "unpaidLeaveDeductionDays" | "latePenaltyAmount" | "latePenaltyDayFraction"> & {
  name: string;
  effectiveFrom: Ymd;
  absentDeductionDays: string;
  halfDayDeductionDays: string;
  unpaidLeaveDeductionDays: string;
  latePenaltyAmount: string | null;
  latePenaltyDayFraction: string | null;
};

export function policyRules(p: PayrollPolicy): PolicyRules {
  return {
    salaryBasis: p.salaryBasis,
    fixedDivisor: p.fixedDivisor,
    countHolidaysAsPaid: p.countHolidaysAsPaid,
    countWeeklyOffAsPaid: p.countWeeklyOffAsPaid,
    absentDeductionDays: p.absentDeductionDays.toString(),
    halfDayDeductionDays: p.halfDayDeductionDays.toString(),
    unpaidLeaveDeductionDays: p.unpaidLeaveDeductionDays.toString(),
    latePenaltyMode: p.latePenaltyMode,
    latesPerAbsent: p.latesPerAbsent,
    latePenaltyAmount: p.latePenaltyAmount?.toString() ?? null,
    latePenaltyDayFraction: p.latePenaltyDayFraction?.toString() ?? null,
    lateGraceCount: p.lateGraceCount,
    prorateNewJoiners: p.prorateNewJoiners,
    roundingMode: p.roundingMode,
    roundingPrecision: p.roundingPrecision,
    currency: p.currency,
  };
}

export async function listPolicies() {
  return prisma.payrollPolicy.findMany({ orderBy: { effectiveFrom: "desc" } });
}

export async function policyFor(db: Db, year: number, month: number): Promise<PayrollPolicy | null> {
  const { start } = monthRange(year, month);
  return db.payrollPolicy.findFirst({ where: { effectiveFrom: { lte: ymdToDb(start) } }, orderBy: { effectiveFrom: "desc" } })
    ?? db.payrollPolicy.findFirst({ orderBy: { effectiveFrom: "asc" } });
}

export async function createPolicy(actor: Actor, input: PolicyInput) {
  assertAdmin(actor);
  if (input.salaryBasis === "FIXED_DIVISOR" && (!input.fixedDivisor || input.fixedDivisor <= 0)) throw new ValidationError("Fixed divisor is required for this basis", { fixedDivisor: ["Required"] });
  if (input.latePenaltyMode === "LATES_TO_ABSENT" && (!input.latesPerAbsent || input.latesPerAbsent <= 0)) throw new ValidationError("Lates per absent is required", { latesPerAbsent: ["Required"] });
  if (input.latePenaltyMode === "FIXED_AMOUNT" && !input.latePenaltyAmount) throw new ValidationError("Late penalty amount is required", { latePenaltyAmount: ["Required"] });
  if (input.latePenaltyMode === "FRACTION_OF_DAY" && !input.latePenaltyDayFraction) throw new ValidationError("Late penalty fraction is required", { latePenaltyDayFraction: ["Required"] });
  const from = ymdToDb(input.effectiveFrom);
  const finalizedAfter = await prisma.payrollRun.findFirst({ where: { status: "FINALIZED", OR: [{ periodYear: { gt: from.getUTCFullYear() } }, { periodYear: from.getUTCFullYear(), periodMonth: { gte: from.getUTCMonth() + 1 } }] } });
  if (finalizedAfter) throw new ConflictError("A finalized payroll run exists on or after that date. Choose a later effective date.");
  const existing = await prisma.payrollPolicy.findUnique({ where: { effectiveFrom: from } });
  const data = {
    name: input.name.trim(),
    effectiveFrom: from,
    salaryBasis: input.salaryBasis,
    fixedDivisor: input.fixedDivisor,
    countHolidaysAsPaid: input.countHolidaysAsPaid,
    countWeeklyOffAsPaid: input.countWeeklyOffAsPaid,
    absentDeductionDays: new Prisma.Decimal(input.absentDeductionDays),
    halfDayDeductionDays: new Prisma.Decimal(input.halfDayDeductionDays),
    unpaidLeaveDeductionDays: new Prisma.Decimal(input.unpaidLeaveDeductionDays),
    latePenaltyMode: input.latePenaltyMode,
    latesPerAbsent: input.latesPerAbsent,
    latePenaltyAmount: input.latePenaltyAmount ? new Prisma.Decimal(input.latePenaltyAmount) : null,
    latePenaltyDayFraction: input.latePenaltyDayFraction ? new Prisma.Decimal(input.latePenaltyDayFraction) : null,
    lateGraceCount: input.lateGraceCount,
    prorateNewJoiners: input.prorateNewJoiners,
    roundingMode: input.roundingMode,
    roundingPrecision: input.roundingPrecision,
    currency: input.currency,
    createdById: actor.userId,
  };
  const p = existing ? await prisma.payrollPolicy.update({ where: { id: existing.id }, data }) : await prisma.payrollPolicy.create({ data });
  await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: existing ? "UPDATE" : "CREATE", entityType: "PayrollPolicy", entityId: p.id, before: existing, after: p });
  return p;
}

// ── Adjustments ──────────────────────────────────────────────────────────────

export async function listAdjustments(actor: Actor, year: number, month: number) {
  assertAdmin(actor);
  return prisma.payrollAdjustment.findMany({ where: { periodYear: year, periodMonth: month }, include: { employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } } }, orderBy: { createdAt: "desc" } });
}

export async function addAdjustment(actor: Actor, input: { employeeId: string; year: number; month: number; kind: "BONUS" | "DEDUCTION"; category: string; amount: string; description?: string | null }) {
  assertAdmin(actor);
  const run = await prisma.payrollRun.findUnique({ where: { periodYear_periodMonth: { periodYear: input.year, periodMonth: input.month } } });
  if (run?.status === "FINALIZED") throw new ConflictError("Payroll for this period is finalized. Reopen it to add adjustments.");
  if (!(await prisma.employee.findUnique({ where: { id: input.employeeId } }))) throw new NotFoundError("Employee not found");
  if (D(input.amount).lte(0)) throw new ValidationError("Amount must be positive", { amount: ["Must be > 0"] });
  const a = await prisma.payrollAdjustment.create({
    data: { employeeId: input.employeeId, periodYear: input.year, periodMonth: input.month, kind: input.kind, category: input.category.trim(), amount: new Prisma.Decimal(input.amount), description: input.description?.trim() || null, createdById: actor.userId },
  });
  await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: "CREATE", entityType: "PayrollAdjustment", entityId: a.id, after: a });
  return a;
}

export async function deleteAdjustment(actor: Actor, id: string) {
  assertAdmin(actor);
  const a = await prisma.payrollAdjustment.findUnique({ where: { id } });
  if (!a) throw new NotFoundError("Adjustment not found");
  if (a.payslipId) throw new ConflictError("This adjustment has been consumed by a finalized payslip.");
  await prisma.payrollAdjustment.delete({ where: { id } });
  await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: "DELETE", entityType: "PayrollAdjustment", entityId: id, before: a });
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface EmployeeMonthInputs {
  input: PayslipInput;
  salary: NonNullable<Awaited<ReturnType<typeof currentSalary>>>;
  employee: Prisma.EmployeeGetPayload<{ include: { department: true; user: { select: { email: true } } } }>;
  daysCountedThrough: Ymd;
}

/**
 * Gather everything the engine needs for one employee-month. When `projectRemaining` is true
 * (employee dashboard), future scheduled days are assumed PRESENT.
 */
export async function collectInputs(db: Db, employeeId: string, year: number, month: number, opts: { projectRemaining?: boolean; adjustments?: AdjustmentInput[] } = {}): Promise<EmployeeMonthInputs | null> {
  const settings = await getSettings();
  const { start, end, days: calendarDays } = monthRange(year, month);
  const today = todayYmd(settings.timezone);
  const through = minYmd(end, addDays(today, -1));
  const employee = await db.employee.findUnique({ where: { id: employeeId }, include: { department: true, user: { select: { email: true } } } });
  if (!employee) return null;
  const salary = await currentSalary(employeeId, end);
  if (!salary) return null;

  await ensureFinalized(db, employeeId, start, through);
  const [records, resolver, holidays] = await Promise.all([
    db.attendanceRecord.findMany({ where: { employeeId, attendanceDate: { gte: ymdToDb(start), lte: ymdToDb(end) } }, include: { leaveRequest: { include: { leaveType: true } } } }),
    scheduleResolver(db, employeeId),
    holidaySet(db, start, end),
  ]);
  const joined = dbToYmd(employee.joinedAt);
  const terminated = employee.terminatedAt ? dbToYmd(employee.terminatedAt) : null;
  const byDate = new Map(records.map((r) => [dbToYmd(r.attendanceDate), r]));

  let scheduledDays = 0, weeklyOffDays = 0, holidayDays = 0, notEmployedScheduledDays = 0, notEmployedCalendarDays = 0;
  let presentDays = 0, lateDays = 0, halfDays = 0, absentDays = 0;
  let paidLeave = D(0), unpaidLeave = D(0);

  for (const ymd of eachDay(start, end)) {
    const employed = ymd >= joined && (terminated === null || ymd <= terminated);
    const s = resolver(ymd);
    const t = s ? dayType(rulesOf(s), ymd, holidays) : "WEEKLY_OFF";
    if (t === "WEEKLY_OFF") weeklyOffDays++;
    else {
      scheduledDays++;
      if (t === "HOLIDAY") holidayDays++;
    }
    if (!employed) {
      notEmployedCalendarDays++;
      if (t !== "WEEKLY_OFF") notEmployedScheduledDays++;
      continue;
    }
    const r = byDate.get(ymd);
    if (r) {
      switch (r.status) {
        case "PRESENT": presentDays++; break;
        case "LATE": lateDays++; break;
        case "HALF_DAY": halfDays++; break;
        case "ABSENT": absentDays++; break;
        case "LEAVE": {
          const isPaid = r.leaveRequest?.leaveType.isPaid ?? true;
          const days = r.leaveRequest?.isHalfDay ? D(0.5) : D(1);
          if (isPaid) paidLeave = paidLeave.plus(days); else unpaidLeave = unpaidLeave.plus(days);
          break;
        }
        default: break; // HOLIDAY / WEEKLY_OFF already counted structurally
      }
    } else if (t === "WORKING" && ymd > through) {
      if (opts.projectRemaining) presentDays++; // assume present for the rest of the month
    }
  }

  return {
    employee,
    salary,
    daysCountedThrough: through,
    input: {
      baseSalary: salary.baseSalary.toString(),
      components: salary.components.map((c) => ({ name: c.name, kind: c.kind, amount: c.amount.toString(), isProrated: c.isProrated })),
      adjustments: opts.adjustments ?? [],
      calendarDays,
      scheduledDays,
      weeklyOffDays,
      holidayDays,
      presentDays,
      lateDays,
      halfDays,
      absentDays,
      paidLeaveDays: paidLeave.toString(),
      unpaidLeaveDays: unpaidLeave.toString(),
      notEmployedScheduledDays,
      notEmployedCalendarDays,
    },
  };
}

// ── Runs ─────────────────────────────────────────────────────────────────────

const runInclude = {
  policy: true,
  payslips: { where: { supersededAt: null }, include: { employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, department: { select: { name: true } } } } }, orderBy: { employee: { employeeCode: "asc" } } },
} satisfies Prisma.PayrollRunInclude;
export type PayrollRunDetail = Prisma.PayrollRunGetPayload<{ include: typeof runInclude }>;

export async function listRuns(actor: Actor) {
  assertAdmin(actor);
  return prisma.payrollRun.findMany({ orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }], include: { policy: { select: { name: true } } } });
}

export async function getRun(actor: Actor, year: number, month: number): Promise<PayrollRunDetail | null> {
  assertAdmin(actor);
  return prisma.payrollRun.findUnique({ where: { periodYear_periodMonth: { periodYear: year, periodMonth: month } }, include: runInclude });
}

export async function runPayroll(actor: Actor, year: number, month: number, opts: { allowCurrentMonth?: boolean } = {}, meta?: { ip?: string | null }) {
  assertAdmin(actor);
  const settings = await getSettings();
  const cur = currentYearMonth(settings.timezone);
  const { start, end } = monthRange(year, month);
  if (year > cur.year || (year === cur.year && month > cur.month)) throw new ValidationError("Cannot run payroll for a future month");
  if (year === cur.year && month === cur.month && !opts.allowCurrentMonth) throw new ValidationError("The current month is still in progress. Tick “allow partial month” to preview it anyway.");
  const policy = await policyFor(prisma, year, month);
  if (!policy) throw new ConflictError("No payroll policy is configured. Create one under Payroll → Policy first.");

  const existing = await prisma.payrollRun.findUnique({ where: { periodYear_periodMonth: { periodYear: year, periodMonth: month } } });
  if (existing?.status === "FINALIZED") throw new ConflictError("This period is finalized. Reopen it to run again.");

  const employees = await prisma.employee.findMany({
    where: { joinedAt: { lte: ymdToDb(end) }, OR: [{ terminatedAt: null }, { terminatedAt: { gte: ymdToDb(start) } }] },
    select: { id: true, employeeCode: true, isActive: true, terminatedAt: true },
    orderBy: { employeeCode: "asc" },
  });
  const adjustments = await prisma.payrollAdjustment.findMany({ where: { periodYear: year, periodMonth: month, payslipId: null } });
  const rules = policyRules(policy);
  const skipped: string[] = [];

  const run = await prisma.$transaction(async (tx) => {
    const r = existing
      ? await tx.payrollRun.update({ where: { id: existing.id }, data: { status: existing.status === "REOPENED" ? "REOPENED" : "DRAFT", policyId: policy.id, policySnapshot: rules as unknown as Prisma.InputJsonValue, runById: actor.userId, runAt: new Date() } })
      : await tx.payrollRun.create({ data: { periodYear: year, periodMonth: month, status: "DRAFT", policyId: policy.id, policySnapshot: rules as unknown as Prisma.InputJsonValue, runById: actor.userId } });

    // Supersede current payslips (draft ones are simply replaced; reopened-finalized ones are kept for audit).
    if (existing?.status === "REOPENED") await tx.payslip.updateMany({ where: { payrollRunId: r.id, supersededAt: null }, data: { supersededAt: new Date() } });
    else await tx.payslip.deleteMany({ where: { payrollRunId: r.id } });

    let totalGross = D(0), totalNet = D(0), count = 0;
    for (const e of employees) {
      // Inactive employees are included only if they were terminated inside/after this month (final settlement).
      if (!e.isActive && !e.terminatedAt) { skipped.push(`${e.employeeCode} (inactive, no termination date)`); continue; }
      const adj = adjustments.filter((a) => a.employeeId === e.id).map((a) => ({ kind: a.kind, category: a.category, amount: a.amount.toString(), description: a.description }));
      const collected = await collectInputs(tx, e.id, year, month, { adjustments: adj });
      if (!collected) { skipped.push(`${e.employeeCode} (no salary record)`); continue; }
      const result = computePayslip(rules, collected.input);
      const { employee, salary, input } = collected;
      await tx.payslip.create({
        data: {
          payrollRunId: r.id,
          employeeId: e.id,
          employeeSnapshot: {
            employeeCode: employee.employeeCode, firstName: employee.firstName, lastName: employee.lastName, designation: employee.designation,
            department: employee.department?.name ?? null, email: employee.user.email, joinedAt: dbToYmd(employee.joinedAt), bankName: employee.bankName,
            bankAccountLast4: employee.bankAccountLast4, bankAccountTitle: employee.bankAccountTitle,
          },
          salarySnapshot: { baseSalary: salary.baseSalary.toString(), currency: salary.currency, effectiveFrom: dbToYmd(salary.effectiveFrom), components: input.components } as unknown as Prisma.InputJsonValue,
          calendarDays: input.calendarDays,
          workingDays: input.scheduledDays,
          payableDays: result.payableDays.toString(),
          presentDays: input.presentDays,
          lateDays: input.lateDays,
          halfDays: input.halfDays,
          absentDays: input.absentDays,
          paidLeaveDays: input.paidLeaveDays.toString(),
          unpaidLeaveDays: input.unpaidLeaveDays.toString(),
          holidayDays: input.holidayDays,
          weeklyOffDays: input.weeklyOffDays,
          perDayRate: result.perDayRate.toString(),
          baseEarned: result.baseEarned.toString(),
          componentsEarned: result.componentsEarned.toString(),
          componentsDeducted: result.componentsDeducted.toString(),
          attendanceDeduction: result.attendanceDeduction.toString(),
          lateDeduction: result.lateDeduction.toString(),
          bonusesTotal: result.bonusesTotal.toString(),
          deductionsTotal: result.deductionsTotal.toString(),
          grossPay: result.grossPay.toString(),
          netPay: result.netPay.toString(),
          currency: rules.currency,
          breakdown: { lines: result.lines, rulesApplied: result.rulesApplied, divisor: result.divisor, adjustmentIds: adjustments.filter((a) => a.employeeId === e.id).map((a) => a.id) } as unknown as Prisma.InputJsonValue,
        },
      });
      totalGross = totalGross.plus(result.grossPay);
      totalNet = totalNet.plus(result.netPay);
      count++;
    }
    const finalRun = await tx.payrollRun.update({ where: { id: r.id }, data: { employeeCount: count, totalGross: totalGross.toString(), totalNet: totalNet.toString(), notes: skipped.length ? `Skipped: ${skipped.join(", ")}` : null } });
    await audit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: "PAYROLL_RUN", entityType: "PayrollRun", entityId: r.id, after: { ...finalRun, skipped }, ip: meta?.ip });
    return finalRun;
  }, { timeout: 120_000 });
  return { run, skipped };
}

export async function finalizeRun(actor: Actor, runId: string, meta?: { ip?: string | null }) {
  assertAdmin(actor);
  const run = await prisma.payrollRun.findUnique({ where: { id: runId }, include: { payslips: { where: { supersededAt: null } } } });
  if (!run) throw new NotFoundError("Payroll run not found");
  if (run.status === "FINALIZED") throw new ConflictError("Already finalized");
  if (!run.payslips.length) throw new ConflictError("Nothing to finalize — run payroll first.");
  const { start, end } = monthRange(run.periodYear, run.periodMonth);
  const prefix = `NT-${run.periodYear}-${String(run.periodMonth).padStart(2, "0")}`;
  await prisma.$transaction(async (tx) => {
    let seq = 1;
    for (const p of run.payslips) {
      const bd = p.breakdown as { adjustmentIds?: string[] };
      const number = `${prefix}-${String(seq++).padStart(4, "0")}${run.reopenedAt ? `-R${Math.max(1, Math.round((run.reopenedAt.getTime() % 97) || 1))}` : ""}`;
      await tx.payslip.update({ where: { id: p.id }, data: { payslipNumber: p.payslipNumber ?? number } });
      if (bd.adjustmentIds?.length) await tx.payrollAdjustment.updateMany({ where: { id: { in: bd.adjustmentIds } }, data: { payslipId: p.id } });
    }
    await tx.attendanceRecord.updateMany({ where: { attendanceDate: { gte: ymdToDb(start), lte: ymdToDb(end) } }, data: { isLocked: true } });
    const after = await tx.payrollRun.update({ where: { id: run.id }, data: { status: "FINALIZED", finalizedById: actor.userId, finalizedAt: new Date() } });
    await audit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: "PAYROLL_FINALIZE", entityType: "PayrollRun", entityId: run.id, before: { status: run.status }, after, ip: meta?.ip });
  }, { timeout: 60_000 });
}

export async function reopenRun(actor: Actor, runId: string, reason: string, meta?: { ip?: string | null }) {
  assertAdmin(actor);
  if (!reason.trim()) throw new ValidationError("A reason is required", { reason: ["Required"] });
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new NotFoundError("Payroll run not found");
  if (run.status !== "FINALIZED") throw new ConflictError("Only finalized runs can be reopened");
  const { start, end } = monthRange(run.periodYear, run.periodMonth);
  await prisma.$transaction(async (tx) => {
    await tx.attendanceRecord.updateMany({ where: { attendanceDate: { gte: ymdToDb(start), lte: ymdToDb(end) } }, data: { isLocked: false } });
    await tx.payrollAdjustment.updateMany({ where: { payslip: { payrollRunId: run.id } }, data: { payslipId: null } });
    const after = await tx.payrollRun.update({ where: { id: run.id }, data: { status: "REOPENED", reopenedById: actor.userId, reopenedAt: new Date(), reopenReason: reason.trim() } });
    await audit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: "PAYROLL_REOPEN", entityType: "PayrollRun", entityId: run.id, before: { status: run.status }, after, ip: meta?.ip });
  });
}

// ── Payslips ─────────────────────────────────────────────────────────────────

const payslipInclude = { run: { select: { periodYear: true, periodMonth: true, status: true, finalizedAt: true } }, employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } } } satisfies Prisma.PayslipInclude;
export type PayslipDetail = Prisma.PayslipGetPayload<{ include: typeof payslipInclude }>;

/** Employee: only finalized payslips, only their own. */
export async function myPayslips(actor: Actor) {
  return prisma.payslip.findMany({ where: { employeeId: ownEmployeeId(actor), supersededAt: null, run: { status: "FINALIZED" } }, include: payslipInclude, orderBy: [{ run: { periodYear: "desc" } }, { run: { periodMonth: "desc" } }] });
}

export async function getMyPayslip(actor: Actor, payslipId: string): Promise<PayslipDetail> {
  const p = await prisma.payslip.findUnique({ where: { id: payslipId }, include: payslipInclude });
  // 404 (not 403) when the payslip belongs to someone else, is a draft, or is superseded.
  if (!p || p.employeeId !== ownEmployeeId(actor) || p.supersededAt || p.run.status !== "FINALIZED") throw new NotFoundError("Payslip not found");
  return p;
}

export async function adminGetPayslip(actor: Actor, payslipId: string): Promise<PayslipDetail> {
  assertAdmin(actor);
  const p = await prisma.payslip.findUnique({ where: { id: payslipId }, include: payslipInclude });
  if (!p) throw new NotFoundError("Payslip not found");
  return p;
}

export async function payslipHistoryFor(actor: Actor, employeeId: string) {
  assertAdmin(actor);
  return prisma.payslip.findMany({ where: { employeeId, supersededAt: null }, include: payslipInclude, orderBy: [{ run: { periodYear: "desc" } }, { run: { periodMonth: "desc" } }] });
}

// ── Projected salary (employee dashboard) ────────────────────────────────────

export async function myProjectedSalary(actor: Actor) {
  const employeeId = ownEmployeeId(actor);
  const settings = await getSettings();
  const { year, month } = currentYearMonth(settings.timezone);
  const final = await prisma.payslip.findFirst({ where: { employeeId, supersededAt: null, run: { periodYear: year, periodMonth: month, status: "FINALIZED" } }, include: payslipInclude });
  if (final) return { kind: "FINAL" as const, payslip: final, year, month };
  const policy = await policyFor(prisma, year, month);
  if (!policy) return { kind: "NO_POLICY" as const, year, month };
  const adjustments = await prisma.payrollAdjustment.findMany({ where: { employeeId, periodYear: year, periodMonth: month } });
  const collected = await collectInputs(prisma, employeeId, year, month, { projectRemaining: true, adjustments: adjustments.map((a) => ({ kind: a.kind, category: a.category, amount: a.amount.toString(), description: a.description })) });
  if (!collected) return { kind: "NO_SALARY" as const, year, month };
  const rules = policyRules(policy);
  return { kind: "PROJECTED" as const, year, month, result: computePayslip(rules, collected.input), input: collected.input, rules, through: collected.daysCountedThrough };
}
