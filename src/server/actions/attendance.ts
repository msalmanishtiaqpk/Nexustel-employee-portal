"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { act, parse, zOptStr, zStr, zUuid, zYmd } from "@/server/actions/util";
import type { ActionState } from "@/server/actions/types";
import { requireAdmin, requireEmployee } from "@/server/rbac";
import { requestMeta } from "@/server/auth/session";
import { correctAttendance, markAttendance } from "@/server/services/attendance";
import { ATTENDANCE_LABEL } from "@/components/ui/badge";
import { fromZonedTime } from "@/lib/dates";
import { getSettings } from "@/server/services/settings";

export async function markAttendanceAction(): Promise<ActionState> {
  return act(async () => {
    const actor = await requireEmployee();
    const rec = await markAttendance(actor, await requestMeta());
    revalidatePath("/");
    revalidatePath("/attendance");
    return { ok: true, message: `Attendance recorded as ${ATTENDANCE_LABEL[rec.status]}.` };
  });
}

export async function correctAttendanceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(
      z.object({
        employeeId: zUuid,
        attendanceDate: zYmd,
        status: z.enum(["PRESENT", "LATE", "ABSENT", "LEAVE", "HALF_DAY", "HOLIDAY", "WEEKLY_OFF"]),
        checkInTime: zOptStr, // HH:MM in company timezone, optional
        reason: zStr,
        returnTo: zOptStr,
      }),
      fd,
    );
    let checkInAt: Date | null = null;
    if (d.checkInTime) {
      const s = await getSettings();
      checkInAt = fromZonedTime(`${d.attendanceDate}T${d.checkInTime.padStart(5, "0")}:00`, s.timezone);
    }
    await correctAttendance(actor, { employeeId: d.employeeId, attendanceDate: d.attendanceDate, status: d.status, checkInAt, reason: d.reason }, await requestMeta());
    revalidatePath("/admin/attendance");
    revalidatePath(`/admin/employees/${d.employeeId}`);
    return { ok: true, message: "Attendance corrected." };
  });
}
