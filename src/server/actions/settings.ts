"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { act, parse, zOptStr, zOptUuid, zStr } from "@/server/actions/util";
import type { ActionState } from "@/server/actions/types";
import { requireAdmin } from "@/server/rbac";
import { requestMeta } from "@/server/auth/session";
import { isCidr, updateSettings } from "@/server/services/settings";

export async function updateSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async (): Promise<ActionState> => {
    const actor = await requireAdmin();
    const d = parse(z.object({ companyName: zStr, timezone: zStr, currency: z.string().trim().length(3).toUpperCase(), defaultScheduleId: zOptUuid, attendanceIpAllowlist: zOptStr, payslipFooter: zOptStr }), fd);
    try { new Intl.DateTimeFormat("en", { timeZone: d.timezone }); } catch { return { ok: false, error: "Unknown timezone", fieldErrors: { timezone: ["Unknown IANA timezone"] } }; }
    const list = (d.attendanceIpAllowlist ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    const bad = list.filter((c) => !isCidr(c));
    if (bad.length) return { ok: false, error: `Invalid IP/CIDR: ${bad.join(", ")}`, fieldErrors: { attendanceIpAllowlist: ["Invalid entries"] } };
    await updateSettings(actor, { companyName: d.companyName, timezone: d.timezone, currency: d.currency, defaultScheduleId: d.defaultScheduleId ?? null, attendanceIpAllowlist: list, payslipFooter: d.payslipFooter ?? null }, await requestMeta());
    revalidatePath("/", "layout");
    return { ok: true, message: "Settings saved." };
  });
}
