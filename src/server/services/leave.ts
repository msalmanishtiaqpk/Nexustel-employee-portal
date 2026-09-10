import { Prisma, type LeaveStatus } from "@prisma/client";
import { prisma, type Db } from "@/server/db";
import type { Actor } from "@/server/auth/actor";
import { assertAdmin, ownEmployeeId } from "@/server/auth/actor";
import { audit } from "@/server/services/audit";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { addDays, dbToYmd, eachDay, todayYmd, ymdParts, ymdToDb, type Ymd } from "@/lib/dates";
import { dayType } from "@/server/services/attendance/window";
import { holidaySet, rulesOf, scheduleResolver } from "@/server/services/schedules";
import { getSettings } from "@/server/services/settings";
import { D } from "@/lib/money";

// ── Leave types ───────────────────────────────────────────────────────────────

export interface LeaveTypeInput {
  name: string;
  code: string;
  isPaid: boolean;
  annualQuotaDays: string | null;
  minNoticeDays: number;
  allowHalfDay: boolean;
  isActive: boolean;
}

export async function listLeaveTypes(includeInactive = true) {
  return prisma.leaveType.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { name: "asc" } });
}

export async function upsertLeaveType(actor: Actor, id: string | null, input: LeaveTypeInput) {
  assertAdmin(actor);
  const data = { ...input, name: input.name.trim(), code: input.code.trim().toUpperCase(), annualQuotaDays: input.annualQuotaDays ? new Prisma.Decimal(input.annualQuotaDays) : null };
  const clash = await prisma.leaveType.findFirst({ where: { OR: [{ name: data.name }, { code: data.code }], ...(id ? { id: { not: id } } : {}) } });
  if (clash) throw new ValidationError("A leave type with this name or code exists", { name: ["Already exists"] });
  const before = id ? await prisma.leaveType.findUnique({ where: { id } }) : null;
  const lt = id ? await prisma.leaveType.update({ where: { id }, data }) : await prisma.leaveType.create({ data });
  await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: id ? "UPDATE" : "CREATE", entityType: "LeaveType", entityId: lt.id, before, after: lt });
  return lt;
}

// ── Working-day computation ───────────────────────────────────────────────────

/** Count the employee's scheduled working days in [start, end] (weekly offs and holidays excluded). */
export async function countWorkingDays(db: Db, employeeId: string, start: Ymd, end: Ymd): Promise<Ymd[]> {
  const resolver = await scheduleResolver(db, employeeId);
  const holidays = await holidaySet(db, start, end);
  const days: Ymd[] = [];
  for (const ymd of eachDay(start, end)) {
    const s = resolver(ymd);
    if (s && dayType(rulesOf(s), ymd, holidays) === "WORKING") days.push(ymd);
  }
  return days;
}

// ── Balances ─────────────────────────────────────────────────────────────────

export interface BalanceRow {
  leaveType: { id: string; name: string; code: string; isPaid: boolean; annualQuotaDays: Prisma.Decimal | null; allowHalfDay: boolean; minNoticeDays: number };
  allocated: Prisma.Decimal | null; // null = unlimited
  used: Prisma.Decimal;
  pending: Prisma.Decimal;
  remaining: Prisma.Decimal | null;
}

export async function balancesFor(db: Db, employeeId: string, year: number): Promise<BalanceRow[]> {
  const [types, balances, requests] = await Promise.all([
    db.leaveType.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.leaveBalance.findMany({ where: { employeeId, year } }),
    db.leaveRequest.findMany({ where: { employeeId, status: { in: ["APPROVED", "PENDING"] }, startDate: { gte: ymdToDb(`${year}-01-01`), lte: ymdToDb(`${year}-12-31`) } } }),
  ]);
  return types.map((t) => {
    const b = balances.find((x) => x.leaveTypeId === t.id);
    const allocated = t.annualQuotaDays === null ? null : new Prisma.Decimal(b ? b.allocatedDays.plus(b.adjustmentDays) : t.annualQuotaDays);
    const used = requests.filter((r) => r.leaveTypeId === t.id && r.status === "APPROVED").reduce((a, r) => a.plus(r.workingDays), new Prisma.Decimal(0));
    const pending = requests.filter((r) => r.leaveTypeId === t.id && r.status === "PENDING").reduce((a, r) => a.plus(r.workingDays), new Prisma.Decimal(0));
    return { leaveType: t, allocated, used, pending, remaining: allocated === null ? null : allocated.minus(used).minus(pending) };
  });
}

export async function adjustBalance(actor: Actor, employeeId: string, leaveTypeId: string, year: number, adjustmentDays: string) {
  assertAdmin(actor);
  const t = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
  if (!t) throw new NotFoundError("Leave type not found");
  const row = await prisma.leaveBalance.upsert({
    where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
    create: { employeeId, leaveTypeId, year, allocatedDays: t.annualQuotaDays ?? new Prisma.Decimal(0), adjustmentDays: new Prisma.Decimal(adjustmentDays) },
    update: { adjustmentDays: new Prisma.Decimal(adjustmentDays) },
  });
  await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: "UPDATE", entityType: "LeaveBalance", entityId: `${employeeId}:${leaveTypeId}:${year}`, after: row });
  return row;
}

// ── Requests ─────────────────────────────────────────────────────────────────

const requestInclude = { leaveType: true, employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, department: { select: { name: true } } } } } satisfies Prisma.LeaveRequestInclude;
export type LeaveRequestRow = Prisma.LeaveRequestGetPayload<{ include: typeof requestInclude }>;

export async function myLeaveRequests(actor: Actor) {
  return prisma.leaveRequest.findMany({ where: { employeeId: ownEmployeeId(actor) }, include: requestInclude, orderBy: { createdAt: "desc" } });
}

export async function myBalances(actor: Actor, year: number) {
  return balancesFor(prisma, ownEmployeeId(actor), year);
}

export interface LeaveRequestInput {
  leaveTypeId: string;
  startDate: Ymd;
  endDate: Ymd;
  isHalfDay: boolean;
  reason: string;
}

export async function submitLeaveRequest(actor: Actor, input: LeaveRequestInput, meta?: { ip?: string | null }) {
  const employeeId = ownEmployeeId(actor);
  const settings = await getSettings();
  const today = todayYmd(settings.timezone);
  const type = await prisma.leaveType.findUnique({ where: { id: input.leaveTypeId } });
  if (!type || !type.isActive) throw new ValidationError("Invalid leave type", { leaveTypeId: ["Invalid"] });
  if (input.endDate < input.startDate) throw new ValidationError("End date must be on or after start date", { endDate: ["Before start"] });
  if (input.isHalfDay && (!type.allowHalfDay || input.startDate !== input.endDate)) throw new ValidationError("Half-day leave must be a single day and allowed for this type", { isHalfDay: ["Not allowed"] });
  if (!input.reason.trim()) throw new ValidationError("Reason is required", { reason: ["Required"] });
  if (type.minNoticeDays > 0 && input.startDate < addDays(today, type.minNoticeDays)) {
    throw new ValidationError(`${type.name} requires at least ${type.minNoticeDays} day(s) notice`, { startDate: [`Requires ${type.minNoticeDays} day(s) notice`] });
  }
  if (input.startDate < addDays(today, -60)) throw new ValidationError("Leave cannot be requested more than 60 days in the past", { startDate: ["Too far in the past"] });
  if (ymdParts(input.startDate).year !== ymdParts(input.endDate).year) throw new ValidationError("A leave request may not span two calendar years", { endDate: ["Split the request at year end"] });

  const days = await countWorkingDays(prisma, employeeId, input.startDate, input.endDate);
  const workingDays = input.isHalfDay ? new Prisma.Decimal(0.5) : new Prisma.Decimal(days.length);
  if (workingDays.lte(0)) throw new ValidationError("The selected range contains no working days", { startDate: ["No working days in range"] });

  const locked = await prisma.attendanceRecord.count({ where: { employeeId, attendanceDate: { gte: ymdToDb(input.startDate), lte: ymdToDb(input.endDate) }, isLocked: true } });
  if (locked) throw new ConflictError("Part of this range belongs to a finalized payroll period.");

  if (type.annualQuotaDays !== null) {
    const bal = (await balancesFor(prisma, employeeId, ymdParts(input.startDate).year)).find((b) => b.leaveType.id === type.id);
    if (bal?.remaining && bal.remaining.lt(workingDays)) {
      throw new ValidationError(`Insufficient ${type.name} balance (${bal.remaining.toString()} day(s) remaining)`, { leaveTypeId: ["Insufficient balance"] });
    }
  }
  try {
    const req = await prisma.leaveRequest.create({
      data: { employeeId, leaveTypeId: type.id, startDate: ymdToDb(input.startDate), endDate: ymdToDb(input.endDate), isHalfDay: input.isHalfDay, workingDays, reason: input.reason.trim() },
    });
    await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: "CREATE", entityType: "LeaveRequest", entityId: req.id, after: req, ip: meta?.ip });
    return req;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2004" || (e instanceof Error && /leave_requests_no_overlap/.test(e.message))) {
      throw new ConflictError("You already have a pending or approved leave request overlapping these dates.");
    }
    throw e;
  }
}

export async function cancelMyLeaveRequest(actor: Actor, requestId: string, meta?: { ip?: string | null }) {
  const employeeId = ownEmployeeId(actor);
  const req = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
  if (!req || req.employeeId !== employeeId) throw new NotFoundError("Leave request not found"); // 404, never 403: no existence leak
  const settings = await getSettings();
  const today = todayYmd(settings.timezone);
  if (req.status === "PENDING" || (req.status === "APPROVED" && dbToYmd(req.startDate) > today)) {
    await prisma.$transaction(async (tx) => {
      await tx.leaveRequest.update({ where: { id: req.id }, data: { status: "CANCELLED" } });
      if (req.status === "APPROVED") await tx.attendanceRecord.deleteMany({ where: { leaveRequestId: req.id, isLocked: false } });
      await audit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: "UPDATE", entityType: "LeaveRequest", entityId: req.id, before: req, after: { status: "CANCELLED" }, ip: meta?.ip });
    });
    return;
  }
  throw new ConflictError("This request can no longer be cancelled.");
}

// ── Admin review ─────────────────────────────────────────────────────────────

export async function listLeaveRequests(actor: Actor, f: { status?: LeaveStatus; employeeId?: string; page?: number; pageSize?: number } = {}) {
  assertAdmin(actor);
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, f.pageSize ?? 25);
  const where: Prisma.LeaveRequestWhereInput = { ...(f.status ? { status: f.status } : {}), ...(f.employeeId ? { employeeId: f.employeeId } : {}) };
  const [items, total] = await Promise.all([
    prisma.leaveRequest.findMany({ where, include: requestInclude, orderBy: [{ status: "asc" }, { createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.leaveRequest.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function reviewLeaveRequest(actor: Actor, requestId: string, decision: "APPROVED" | "REJECTED", note: string | null, meta?: { ip?: string | null }) {
  assertAdmin(actor);
  const req = await prisma.leaveRequest.findUnique({ where: { id: requestId }, include: { leaveType: true } });
  if (!req) throw new NotFoundError("Leave request not found");
  if (req.status !== "PENDING") throw new ConflictError("Only pending requests can be reviewed.");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.leaveRequest.update({ where: { id: req.id }, data: { status: decision, reviewedById: actor.userId, reviewedAt: new Date(), reviewNote: note?.trim() || null } });
    let skippedLocked = 0;
    if (decision === "APPROVED") {
      const days = await countWorkingDays(tx, req.employeeId, dbToYmd(req.startDate), dbToYmd(req.endDate));
      for (const ymd of days) {
        const existing = await tx.attendanceRecord.findUnique({ where: { employeeId_attendanceDate: { employeeId: req.employeeId, attendanceDate: ymdToDb(ymd) } } });
        if (existing?.isLocked) { skippedLocked++; continue; }
        if (existing && (existing.source === "SELF" || existing.source === "ADMIN") && existing.status !== "ABSENT") continue; // employee actually came in
        const data = { status: "LEAVE" as const, checkInAt: null, minutesLate: null, source: "LEAVE_APPROVAL" as const, markedById: actor.userId, leaveRequestId: req.id, note: `${req.leaveType.name} leave` };
        if (existing) await tx.attendanceRecord.update({ where: { id: existing.id }, data });
        else await tx.attendanceRecord.create({ data: { ...data, employeeId: req.employeeId, attendanceDate: ymdToDb(ymd) } });
      }
    }
    await audit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: "LEAVE_REVIEW", entityType: "LeaveRequest", entityId: req.id, before: req, after: { ...updated, skippedLocked }, ip: meta?.ip });
    return { updated, skippedLocked };
  });
}

export function leaveDaysLabel(d: Prisma.Decimal | number | string) {
  const v = D(d.toString());
  return `${v.toString()} day${v.eq(1) ? "" : "s"}`;
}
