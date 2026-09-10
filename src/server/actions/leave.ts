"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { act, parse, zBool, zInt, zOptStr, zStr, zUuid, zYmd } from "@/server/actions/util";
import type { ActionState } from "@/server/actions/types";
import { requireAdmin, requireEmployee } from "@/server/rbac";
import { requestMeta } from "@/server/auth/session";
import * as svc from "@/server/services/leave";

export async function submitLeaveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireEmployee();
    const d = parse(z.object({ leaveTypeId: zUuid, startDate: zYmd, endDate: zYmd, isHalfDay: zBool.default(false), reason: zStr }), fd);
    await svc.submitLeaveRequest(actor, d, await requestMeta());
    revalidatePath("/leave");
    return { ok: true, message: "Leave request submitted." };
  });
}

export async function cancelLeaveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireEmployee();
    const d = parse(z.object({ id: zUuid }), fd);
    await svc.cancelMyLeaveRequest(actor, d.id, await requestMeta());
    revalidatePath("/leave");
    return { ok: true, message: "Leave request cancelled." };
  });
}

export async function reviewLeaveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(z.object({ id: zUuid, decision: z.enum(["APPROVED", "REJECTED"]), note: zOptStr }), fd);
    const { skippedLocked } = await svc.reviewLeaveRequest(actor, d.id, d.decision, d.note ?? null, await requestMeta());
    revalidatePath("/admin/leave");
    revalidatePath("/admin");
    return { ok: true, message: `Request ${d.decision.toLowerCase()}.${skippedLocked ? ` ${skippedLocked} day(s) were in a finalized payroll period and were not changed.` : ""}` };
  });
}

export async function upsertLeaveTypeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(
      z.object({
        id: z.preprocess((v) => (v === "" ? null : v), zUuid.nullable()),
        name: zStr,
        code: zStr,
        isPaid: zBool.default(false),
        annualQuotaDays: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d+(\.\d)?$/, "Use whole or half days").nullable()),
        minNoticeDays: zInt.min(0).default(0),
        allowHalfDay: zBool.default(false),
        isActive: zBool.default(true),
      }),
      fd,
    );
    await svc.upsertLeaveType(actor, d.id, d);
    revalidatePath("/admin/leave/types");
    return { ok: true, message: "Leave type saved." };
  });
}

export async function adjustBalanceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(z.object({ employeeId: zUuid, leaveTypeId: zUuid, year: zInt, adjustmentDays: z.string().regex(/^-?\d+(\.\d)?$/, "Use whole or half days") }), fd);
    await svc.adjustBalance(actor, d.employeeId, d.leaveTypeId, d.year, d.adjustmentDays);
    revalidatePath(`/admin/employees/${d.employeeId}`);
    return { ok: true, message: "Balance adjusted." };
  });
}
