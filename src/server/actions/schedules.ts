"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { act, parse, zBool, zInt, zOptStr, zOptUuid, zStr, zUuid, zYmd } from "@/server/actions/util";
import type { ActionState } from "@/server/actions/types";
import { requireAdmin } from "@/server/rbac";
import * as svc from "@/server/services/schedules";
import { hhmmToMinutes } from "@/lib/dates";

const scheduleSchema = z.object({
  name: zStr,
  timezone: zStr,
  shiftStart: z.string().regex(/^\d{1,2}:\d{2}$/, "HH:MM"),
  shiftEnd: z.string().regex(/^\d{1,2}:\d{2}$/, "HH:MM"),
  workingDays: z.array(z.coerce.number().int().min(1).max(7)).min(1, "Select at least one working day"),
  checkinOpensMinBefore: zInt.min(0),
  lateAfterMin: zInt.min(0),
  halfDayAfterMin: zInt.min(0),
  checkinClosesAfterMin: zInt.min(1),
  isActive: zBool.default(true),
});

function toInput(d: z.infer<typeof scheduleSchema>) {
  return { ...d, shiftStartMin: hhmmToMinutes(d.shiftStart), shiftEndMin: hhmmToMinutes(d.shiftEnd), workingDays: [...new Set(d.workingDays)] };
}

export async function createScheduleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(scheduleSchema, fd);
    const s = await svc.createSchedule(actor, toInput(d));
    revalidatePath("/admin/schedules");
    return { ok: true, message: `Schedule “${s.name}” created.`, data: { id: s.id } };
  });
}

export async function updateScheduleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(scheduleSchema.extend({ id: zUuid }), fd);
    await svc.updateSchedule(actor, d.id, toInput(d));
    revalidatePath("/admin/schedules");
    return { ok: true, message: "Schedule updated." };
  });
}

export async function createHolidayAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(z.object({ date: zYmd, name: zStr, isPaid: zBool.default(true) }), fd);
    await svc.createHoliday(actor, d.date, d.name, d.isPaid);
    revalidatePath("/admin/holidays");
    return { ok: true, message: "Holiday added." };
  });
}

export async function deleteHolidayAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(z.object({ id: zUuid }), fd);
    await svc.deleteHoliday(actor, d.id);
    revalidatePath("/admin/holidays");
  });
}

const optInt = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().int().min(0).nullable());

export async function createOverrideAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(z.object({ date: zYmd, scheduleId: zOptUuid, reason: zOptStr, checkinOpensMinBefore: optInt, lateAfterMin: optInt, halfDayAfterMin: optInt, checkinClosesAfterMin: optInt }), fd);
    await svc.createOverride(actor, { ...d, scheduleId: d.scheduleId ?? null, reason: d.reason ?? null });
    revalidatePath("/admin/holidays");
    return { ok: true, message: "Window override saved." };
  });
}

export async function deleteOverrideAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(z.object({ id: zUuid }), fd);
    await svc.deleteOverride(actor, d.id);
    revalidatePath("/admin/holidays");
  });
}
