"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { act, parse, zBool, zInt, zMoney, zOptStr, zStr, zUuid, zYmd } from "@/server/actions/util";
import type { ActionState } from "@/server/actions/types";
import { requireAdmin } from "@/server/rbac";
import { requestMeta } from "@/server/auth/session";
import * as svc from "@/server/services/payroll/run";

const optMoney = z.preprocess((v) => (v === "" ? null : v), zMoney.nullable());
const optInt = z.preprocess((v) => (v === "" ? null : v), z.coerce.number().int().nullable());

export async function createPolicyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(
      z.object({
        name: zStr,
        effectiveFrom: zYmd,
        salaryBasis: z.enum(["WORKING_DAYS", "CALENDAR_DAYS", "FIXED_DIVISOR"]),
        fixedDivisor: optInt,
        countHolidaysAsPaid: zBool.default(false),
        countWeeklyOffAsPaid: zBool.default(false),
        absentDeductionDays: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter days, e.g. 1 or 0.5"),
        halfDayDeductionDays: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter days, e.g. 0.5"),
        unpaidLeaveDeductionDays: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter days"),
        latePenaltyMode: z.enum(["NONE", "LATES_TO_ABSENT", "FIXED_AMOUNT", "FRACTION_OF_DAY"]),
        latesPerAbsent: optInt,
        latePenaltyAmount: optMoney,
        latePenaltyDayFraction: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^0?\.\d{1,2}$|^1(\.0{1,2})?$/, "Fraction between 0 and 1").nullable()),
        lateGraceCount: zInt.min(0).default(0),
        prorateNewJoiners: zBool.default(false),
        roundingMode: z.enum(["HALF_UP", "FLOOR", "CEIL"]),
        roundingPrecision: zInt.min(0).max(2),
        currency: z.string().trim().length(3).toUpperCase(),
      }),
      fd,
    );
    await svc.createPolicy(actor, d);
    revalidatePath("/admin/payroll/policy");
    return { ok: true, message: "Payroll policy saved." };
  });
}

export async function addAdjustmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(z.object({ employeeId: zUuid, year: zInt, month: zInt.min(1).max(12), kind: z.enum(["BONUS", "DEDUCTION"]), category: zStr, amount: zMoney, description: zOptStr }), fd);
    await svc.addAdjustment(actor, d);
    revalidatePath(`/admin/payroll/${d.year}/${d.month}`);
    return { ok: true, message: `${d.kind === "BONUS" ? "Bonus" : "Deduction"} added. Re-run the draft to apply it.` };
  });
}

export async function deleteAdjustmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(z.object({ id: zUuid, year: zInt, month: zInt }), fd);
    await svc.deleteAdjustment(actor, d.id);
    revalidatePath(`/admin/payroll/${d.year}/${d.month}`);
    return { ok: true, message: "Adjustment removed. Re-run the draft to apply." };
  });
}

export async function runPayrollAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(z.object({ year: zInt.min(2000).max(2100), month: zInt.min(1).max(12), allowCurrentMonth: zBool.default(false) }), fd);
    const { run, skipped } = await svc.runPayroll(actor, d.year, d.month, { allowCurrentMonth: d.allowCurrentMonth }, await requestMeta());
    revalidatePath("/admin/payroll");
    revalidatePath(`/admin/payroll/${d.year}/${d.month}`);
    return { ok: true, message: `Draft computed for ${run.employeeCount} employee(s).${skipped.length ? ` Skipped: ${skipped.join(", ")}.` : ""}`, data: { year: d.year, month: d.month } };
  });
}

export async function finalizeRunAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(z.object({ runId: zUuid, year: zInt, month: zInt, confirm: zBool }), fd);
    if (!d.confirm) return { ok: false, error: "Please tick the confirmation box." };
    await svc.finalizeRun(actor, d.runId, await requestMeta());
    revalidatePath("/admin/payroll");
    revalidatePath(`/admin/payroll/${d.year}/${d.month}`);
    return { ok: true, message: "Payroll finalized. Payslips are now visible to employees." };
  });
}

export async function reopenRunAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(z.object({ runId: zUuid, year: zInt, month: zInt, reason: zStr }), fd);
    await svc.reopenRun(actor, d.runId, d.reason, await requestMeta());
    revalidatePath("/admin/payroll");
    revalidatePath(`/admin/payroll/${d.year}/${d.month}`);
    return { ok: true, message: "Payroll reopened. Attendance is unlocked; re-run to produce updated payslips." };
  });
}
