"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { act, parse, zBool, zEmail, zMoney, zOptStr, zOptUuid, zOptYmd, zStr, zUuid, zYmd } from "@/server/actions/util";
import type { ActionState } from "@/server/actions/types";
import { requireAdmin, requireEmployee } from "@/server/rbac";
import { requestMeta } from "@/server/auth/session";
import * as svc from "@/server/services/employees";

const employeeSchema = z.object({
  email: zEmail,
  employeeCode: zOptStr,
  firstName: zStr,
  lastName: zStr,
  phone: zOptStr,
  personalEmail: zOptStr,
  nationalId: zOptStr,
  dateOfBirth: zOptYmd,
  gender: zOptStr,
  address: zOptStr,
  emergencyContactName: zOptStr,
  emergencyContactPhone: zOptStr,
  departmentId: zOptUuid,
  designation: zOptStr,
  employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "PROBATION"]),
  managerId: zOptUuid,
  joinedAt: zYmd,
  probationEndsAt: zOptYmd,
  terminatedAt: zOptYmd,
  bankName: zOptStr,
  bankAccount: zOptStr,
  bankAccountTitle: zOptStr,
  notes: zOptStr,
  role: z.enum(["ADMIN", "EMPLOYEE"]).default("EMPLOYEE"),
});

export async function createEmployeeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(employeeSchema.extend({ baseSalary: zMoney, scheduleId: zOptUuid }), fd);
    const { employee, tempPassword } = await svc.createEmployee(actor, d, await requestMeta());
    revalidatePath("/admin/employees");
    return { ok: true, message: `Employee ${employee.employeeCode} created.`, data: { employeeId: employee.id, tempPassword, email: d.email } };
  });
}

export async function updateEmployeeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(employeeSchema.extend({ employeeId: zUuid }), fd);
    await svc.updateEmployee(actor, d.employeeId, d, await requestMeta());
    revalidatePath(`/admin/employees/${d.employeeId}`);
    return { ok: true, message: "Employee updated." };
  });
}

export async function setEmployeeActiveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(z.object({ employeeId: zUuid, active: zBool }), fd);
    await svc.setEmployeeActive(actor, d.employeeId, d.active, await requestMeta());
    revalidatePath(`/admin/employees/${d.employeeId}`);
    revalidatePath("/admin/employees");
    return { ok: true, message: d.active ? "Employee activated." : "Employee deactivated and signed out everywhere." };
  });
}

export async function resetPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(z.object({ employeeId: zUuid }), fd);
    const { tempPassword } = await svc.resetEmployeePassword(actor, d.employeeId, await requestMeta());
    return { ok: true, message: "Temporary password generated. Share it securely; the employee must change it at next login.", data: { tempPassword } };
  });
}

export async function setSalaryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(
      z.object({
        employeeId: zUuid,
        baseSalary: zMoney,
        effectiveFrom: zYmd,
        reason: zOptStr,
        componentName: z.array(z.string()).optional(),
        componentKind: z.array(z.enum(["BONUS", "DEDUCTION"])).optional(),
        componentAmount: z.array(z.string()).optional(),
        componentProrated: z.array(z.string()).optional(),
      }),
      fd,
    );
    const components = (d.componentName ?? [])
      .map((name, i) => ({ name: name.trim(), kind: d.componentKind?.[i] ?? "BONUS", amount: (d.componentAmount?.[i] ?? "").trim(), isProrated: d.componentProrated?.[i] === "1" }))
      .filter((c) => c.name && c.amount);
    for (const c of components) if (!/^\d+(\.\d{1,2})?$/.test(c.amount)) return { ok: false, error: `Invalid amount for ${c.name}` };
    await svc.setSalary(actor, d.employeeId, { baseSalary: d.baseSalary, effectiveFrom: d.effectiveFrom, reason: d.reason, components }, await requestMeta());
    revalidatePath(`/admin/employees/${d.employeeId}`);
    return { ok: true, message: "Salary record saved." };
  });
}

export async function assignScheduleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(z.object({ employeeId: zUuid, scheduleId: zUuid, effectiveFrom: zYmd }), fd);
    await svc.assignSchedule(actor, d.employeeId, d.scheduleId, d.effectiveFrom, await requestMeta());
    revalidatePath(`/admin/employees/${d.employeeId}`);
    return { ok: true, message: "Schedule assigned." };
  });
}

export async function updateMyContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireEmployee();
    const d = parse(z.object({ phone: zOptStr, personalEmail: zOptStr, address: zOptStr, emergencyContactName: zOptStr, emergencyContactPhone: zOptStr }), fd);
    await svc.updateMyContactInfo(actor, d);
    revalidatePath("/profile");
    return { ok: true, message: "Contact details updated." };
  });
}

export async function createDepartmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(z.object({ name: zStr }), fd);
    await svc.createDepartment(actor, d.name);
    revalidatePath("/admin/settings");
    return { ok: true, message: "Department created." };
  });
}

export async function setDepartmentActiveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireAdmin();
    const d = parse(z.object({ id: zUuid, active: zBool }), fd);
    await svc.setDepartmentActive(actor, d.id, d.active);
    revalidatePath("/admin/settings");
  });
}
