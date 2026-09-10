import { Prisma, type EmploymentType } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/auth/actor";
import { assertAdmin, ownEmployeeId } from "@/server/auth/actor";
import { audit } from "@/server/services/audit";
import { hashPassword } from "@/server/auth/password";
import { revokeAllSessions } from "@/server/auth/session";
import { decryptField, encryptField, generateTemporaryPassword, last4 } from "@/lib/crypto";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { dbToYmd, ymdToDb, type Ymd } from "@/lib/dates";
import { getSettings } from "@/server/services/settings";

export interface EmployeeInput {
  email: string;
  employeeCode?: string | null;
  firstName: string;
  lastName: string;
  phone?: string | null;
  personalEmail?: string | null;
  nationalId?: string | null;
  dateOfBirth?: Ymd | null;
  gender?: string | null;
  address?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  departmentId?: string | null;
  designation?: string | null;
  employmentType: EmploymentType;
  managerId?: string | null;
  joinedAt: Ymd;
  probationEndsAt?: Ymd | null;
  terminatedAt?: Ymd | null;
  bankName?: string | null;
  bankAccount?: string | null;
  bankAccountTitle?: string | null;
  notes?: string | null;
  role?: "ADMIN" | "EMPLOYEE";
}

export interface CreateEmployeeInput extends EmployeeInput {
  baseSalary: string;
  scheduleId?: string | null;
}

const listSelect = {
  id: true, employeeCode: true, firstName: true, lastName: true, designation: true, employmentType: true, isActive: true, joinedAt: true, phone: true,
  department: { select: { id: true, name: true } },
  user: { select: { email: true, role: true, lastLoginAt: true } },
} satisfies Prisma.EmployeeSelect;

export type EmployeeListItem = Prisma.EmployeeGetPayload<{ select: typeof listSelect }>;

export interface ListFilter {
  q?: string;
  departmentId?: string;
  active?: "all" | "active" | "inactive";
  page?: number;
  pageSize?: number;
}

export async function listEmployees(actor: Actor, f: ListFilter = {}) {
  assertAdmin(actor);
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 25));
  const where: Prisma.EmployeeWhereInput = {
    ...(f.departmentId ? { departmentId: f.departmentId } : {}),
    ...(f.active === "active" ? { isActive: true } : f.active === "inactive" ? { isActive: false } : {}),
    ...(f.q
      ? {
          OR: [
            { firstName: { contains: f.q, mode: "insensitive" } },
            { lastName: { contains: f.q, mode: "insensitive" } },
            { employeeCode: { contains: f.q, mode: "insensitive" } },
            { designation: { contains: f.q, mode: "insensitive" } },
            { user: { email: { contains: f.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.employee.findMany({ where, select: listSelect, orderBy: [{ isActive: "desc" }, { employeeCode: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.employee.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function listActiveEmployeesBrief(actor: Actor) {
  assertAdmin(actor);
  return prisma.employee.findMany({
    where: { isActive: true },
    select: { id: true, employeeCode: true, firstName: true, lastName: true, department: { select: { name: true } } },
    orderBy: { employeeCode: "asc" },
  });
}

const detailInclude = {
  user: { select: { id: true, email: true, role: true, isActive: true, lastLoginAt: true, mustChangePassword: true } },
  department: true,
  manager: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
  salaries: { orderBy: { effectiveFrom: "desc" }, include: { components: true } },
  schedules: { orderBy: { effectiveFrom: "desc" }, include: { schedule: true } },
} satisfies Prisma.EmployeeInclude;

export type EmployeeDetail = Prisma.EmployeeGetPayload<{ include: typeof detailInclude }> & {
  nationalId: string | null;
  bankAccount: string | null;
};

async function loadDetail(employeeId: string, revealSensitive: boolean): Promise<EmployeeDetail> {
  const e = await prisma.employee.findUnique({ where: { id: employeeId }, include: detailInclude });
  if (!e) throw new NotFoundError("Employee not found");
  return {
    ...e,
    nationalId: revealSensitive ? decryptField(e.nationalIdEncrypted) : e.nationalIdLast4 ? `•••• ${e.nationalIdLast4}` : null,
    bankAccount: revealSensitive ? decryptField(e.bankAccountEncrypted) : e.bankAccountLast4 ? `•••• ${e.bankAccountLast4}` : null,
  };
}

/** Admin: any employee. */
export async function getEmployee(actor: Actor, employeeId: string): Promise<EmployeeDetail> {
  assertAdmin(actor);
  return loadDetail(employeeId, true);
}

/** Employee: only their own profile — the id comes from the session, never from the request. */
export async function getMyProfile(actor: Actor): Promise<EmployeeDetail> {
  return loadDetail(ownEmployeeId(actor), false);
}

export async function currentSalary(employeeId: string, onYmd: Ymd) {
  const d = ymdToDb(onYmd);
  return prisma.employeeSalary.findFirst({
    where: { employeeId, effectiveFrom: { lte: d }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: d } }] },
    include: { components: true },
    orderBy: { effectiveFrom: "desc" },
  });
}

async function nextEmployeeCode(): Promise<string> {
  const last = await prisma.employee.findFirst({ where: { employeeCode: { startsWith: "NT-" } }, orderBy: { employeeCode: "desc" }, select: { employeeCode: true } });
  const n = last ? Number(last.employeeCode.replace(/\D/g, "")) + 1 : 1;
  return `NT-${String(Number.isFinite(n) ? n : 1).padStart(4, "0")}`;
}

function toEmployeeData(input: EmployeeInput): Prisma.EmployeeUncheckedUpdateInput {
  const nid = input.nationalId?.trim() || null;
  const bank = input.bankAccount?.trim() || null;
  return {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    phone: input.phone?.trim() || null,
    personalEmail: input.personalEmail?.trim().toLowerCase() || null,
    ...(input.nationalId !== undefined ? { nationalIdEncrypted: nid ? encryptField(nid) : null, nationalIdLast4: last4(nid) } : {}),
    dateOfBirth: input.dateOfBirth ? ymdToDb(input.dateOfBirth) : null,
    gender: input.gender?.trim() || null,
    address: input.address?.trim() || null,
    emergencyContactName: input.emergencyContactName?.trim() || null,
    emergencyContactPhone: input.emergencyContactPhone?.trim() || null,
    departmentId: input.departmentId || null,
    designation: input.designation?.trim() || null,
    employmentType: input.employmentType,
    managerId: input.managerId || null,
    joinedAt: ymdToDb(input.joinedAt),
    probationEndsAt: input.probationEndsAt ? ymdToDb(input.probationEndsAt) : null,
    terminatedAt: input.terminatedAt ? ymdToDb(input.terminatedAt) : null,
    bankName: input.bankName?.trim() || null,
    ...(input.bankAccount !== undefined ? { bankAccountEncrypted: bank ? encryptField(bank) : null, bankAccountLast4: last4(bank) } : {}),
    bankAccountTitle: input.bankAccountTitle?.trim() || null,
    notes: input.notes?.trim() || null,
  };
}

export async function createEmployee(actor: Actor, input: CreateEmployeeInput, meta?: { ip?: string | null }) {
  assertAdmin(actor);
  const email = input.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw new ValidationError("Email already in use", { email: ["Email already in use"] });
  const code = input.employeeCode?.trim() || (await nextEmployeeCode());
  if (await prisma.employee.findUnique({ where: { employeeCode: code } })) throw new ValidationError("Employee code already in use", { employeeCode: ["Employee code already in use"] });

  const tempPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(tempPassword);
  const settings = await getSettings();
  const scheduleId = input.scheduleId || settings.defaultScheduleId;

  const employee = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, passwordHash, role: input.role ?? "EMPLOYEE", mustChangePassword: true } });
    const emp = await tx.employee.create({
      data: { ...(toEmployeeData(input) as Prisma.EmployeeUncheckedCreateInput), userId: user.id, employeeCode: code, joinedAt: ymdToDb(input.joinedAt) },
    });
    await tx.employeeSalary.create({
      data: { employeeId: emp.id, baseSalary: new Prisma.Decimal(input.baseSalary), currency: settings.currency, effectiveFrom: ymdToDb(input.joinedAt), reason: "Initial salary", createdById: actor.userId },
    });
    if (scheduleId) {
      await tx.employeeSchedule.create({ data: { employeeId: emp.id, scheduleId, effectiveFrom: ymdToDb(input.joinedAt), createdById: actor.userId } });
    }
    await audit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: "CREATE", entityType: "Employee", entityId: emp.id, after: { ...emp, email, baseSalary: input.baseSalary, scheduleId }, ip: meta?.ip });
    return emp;
  });
  return { employee, tempPassword };
}

export async function updateEmployee(actor: Actor, employeeId: string, input: EmployeeInput, meta?: { ip?: string | null }) {
  assertAdmin(actor);
  const before = await prisma.employee.findUnique({ where: { id: employeeId }, include: { user: { select: { email: true, role: true } } } });
  if (!before) throw new NotFoundError("Employee not found");
  const email = input.email.trim().toLowerCase();
  if (email !== before.user.email && (await prisma.user.findUnique({ where: { email } }))) throw new ValidationError("Email already in use", { email: ["Email already in use"] });
  const code = input.employeeCode?.trim() || before.employeeCode;
  if (code !== before.employeeCode && (await prisma.employee.findUnique({ where: { employeeCode: code } }))) throw new ValidationError("Employee code already in use", { employeeCode: ["Employee code already in use"] });
  if (input.managerId === employeeId) throw new ValidationError("An employee cannot be their own manager", { managerId: ["Cannot be self"] });

  const role = input.role ?? before.user.role;
  if (before.user.role === "ADMIN" && role !== "ADMIN") await ensureNotLastAdmin(before.userId);

  return prisma.$transaction(async (tx) => {
    const after = await tx.employee.update({ where: { id: employeeId }, data: { ...toEmployeeData(input), employeeCode: code } });
    await tx.user.update({ where: { id: before.userId }, data: { email, role } });
    await audit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: "UPDATE", entityType: "Employee", entityId: employeeId, before, after: { ...after, email, role }, ip: meta?.ip });
    return after;
  });
}

/** Employee self-service: only a small allow-listed set of contact fields. */
export async function updateMyContactInfo(actor: Actor, input: { phone?: string | null; personalEmail?: string | null; address?: string | null; emergencyContactName?: string | null; emergencyContactPhone?: string | null }) {
  const employeeId = ownEmployeeId(actor);
  const before = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { phone: true, personalEmail: true, address: true, emergencyContactName: true, emergencyContactPhone: true } });
  const data = {
    phone: input.phone?.trim() || null,
    personalEmail: input.personalEmail?.trim().toLowerCase() || null,
    address: input.address?.trim() || null,
    emergencyContactName: input.emergencyContactName?.trim() || null,
    emergencyContactPhone: input.emergencyContactPhone?.trim() || null,
  };
  await prisma.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: employeeId }, data });
    await audit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: "UPDATE", entityType: "Employee", entityId: employeeId, before, after: data });
  });
}

async function ensureNotLastAdmin(userId: string) {
  const others = await prisma.user.count({ where: { role: "ADMIN", isActive: true, id: { not: userId } } });
  if (others === 0) throw new ConflictError("Cannot remove or deactivate the last active administrator");
}

export async function setEmployeeActive(actor: Actor, employeeId: string, active: boolean, meta?: { ip?: string | null }) {
  assertAdmin(actor);
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, include: { user: true } });
  if (!emp) throw new NotFoundError("Employee not found");
  if (emp.userId === actor.userId && !active) throw new ConflictError("You cannot deactivate your own account");
  if (!active && emp.user.role === "ADMIN") await ensureNotLastAdmin(emp.userId);
  await prisma.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: employeeId }, data: { isActive: active } });
    await tx.user.update({ where: { id: emp.userId }, data: { isActive: active } });
    await audit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: "UPDATE", entityType: "Employee", entityId: employeeId, before: { isActive: emp.isActive }, after: { isActive: active }, ip: meta?.ip });
  });
  if (!active) await revokeAllSessions(emp.userId);
}

export async function resetEmployeePassword(actor: Actor, employeeId: string, meta?: { ip?: string | null }) {
  assertAdmin(actor);
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { userId: true } });
  if (!emp) throw new NotFoundError("Employee not found");
  const tempPassword = generateTemporaryPassword();
  await prisma.user.update({ where: { id: emp.userId }, data: { passwordHash: await hashPassword(tempPassword), mustChangePassword: true, failedLoginAttempts: 0, lockedUntil: null } });
  await revokeAllSessions(emp.userId);
  await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: "PASSWORD_CHANGE", entityType: "User", entityId: emp.userId, after: { resetByAdmin: true }, ip: meta?.ip });
  return { tempPassword };
}

// ── Salary history ────────────────────────────────────────────────────────────

export interface SalaryInput {
  baseSalary: string;
  effectiveFrom: Ymd;
  reason?: string | null;
  components: { name: string; kind: "BONUS" | "DEDUCTION"; amount: string; isProrated: boolean }[];
}

export async function setSalary(actor: Actor, employeeId: string, input: SalaryInput, meta?: { ip?: string | null }) {
  assertAdmin(actor);
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) throw new NotFoundError("Employee not found");
  const from = ymdToDb(input.effectiveFrom);
  const settings = await getSettings();
  return prisma.$transaction(async (tx) => {
    // Close any record that is current on/after the new effective date; delete future-dated ones that would overlap.
    const overlapping = await tx.employeeSalary.findMany({ where: { employeeId, OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }] } });
    for (const s of overlapping) {
      if (s.effectiveFrom >= from) {
        // A future record starting on/after the new date is superseded.
        await tx.employeeSalary.delete({ where: { id: s.id } });
      } else {
        await tx.employeeSalary.update({ where: { id: s.id }, data: { effectiveTo: from } });
      }
    }
    const created = await tx.employeeSalary.create({
      data: {
        employeeId,
        baseSalary: new Prisma.Decimal(input.baseSalary),
        currency: settings.currency,
        effectiveFrom: from,
        reason: input.reason?.trim() || null,
        createdById: actor.userId,
        components: { create: input.components.map((c) => ({ name: c.name.trim(), kind: c.kind, amount: new Prisma.Decimal(c.amount), isProrated: c.isProrated })) },
      },
      include: { components: true },
    });
    await audit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: "UPDATE", entityType: "EmployeeSalary", entityId: created.id, before: overlapping, after: created, ip: meta?.ip });
    return created;
  });
}

// ── Schedule assignment ──────────────────────────────────────────────────────

export async function assignSchedule(actor: Actor, employeeId: string, scheduleId: string, effectiveFrom: Ymd, meta?: { ip?: string | null }) {
  assertAdmin(actor);
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) throw new NotFoundError("Employee not found");
  const from = ymdToDb(effectiveFrom);
  return prisma.$transaction(async (tx) => {
    const overlapping = await tx.employeeSchedule.findMany({ where: { employeeId, OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }] } });
    for (const s of overlapping) {
      if (s.effectiveFrom >= from) await tx.employeeSchedule.delete({ where: { id: s.id } });
      else await tx.employeeSchedule.update({ where: { id: s.id }, data: { effectiveTo: from } });
    }
    const created = await tx.employeeSchedule.create({ data: { employeeId, scheduleId, effectiveFrom: from, createdById: actor.userId } });
    await audit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: "UPDATE", entityType: "EmployeeSchedule", entityId: created.id, before: overlapping, after: created, ip: meta?.ip });
    return created;
  });
}

// ── Departments ──────────────────────────────────────────────────────────────

export async function listDepartments() {
  return prisma.department.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { employees: true } } } });
}

export async function createDepartment(actor: Actor, name: string) {
  assertAdmin(actor);
  const n = name.trim();
  if (!n) throw new ValidationError("Name is required", { name: ["Required"] });
  if (await prisma.department.findUnique({ where: { name: n } })) throw new ValidationError("Department already exists", { name: ["Already exists"] });
  const d = await prisma.department.create({ data: { name: n } });
  await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: "CREATE", entityType: "Department", entityId: d.id, after: d });
  return d;
}

export async function setDepartmentActive(actor: Actor, id: string, active: boolean) {
  assertAdmin(actor);
  const d = await prisma.department.update({ where: { id }, data: { isActive: active } });
  await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: "UPDATE", entityType: "Department", entityId: id, after: d });
}

export { dbToYmd };
