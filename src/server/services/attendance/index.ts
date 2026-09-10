import { Prisma, type AttendanceStatus, type WorkSchedule } from "@prisma/client";
import { prisma, type Db } from "@/server/db";
import type { Actor } from "@/server/auth/actor";
import { assertAdmin, ownEmployeeId } from "@/server/auth/actor";
import { audit } from "@/server/services/audit";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { addDays, dbToYmd, eachDay, maxYmd, minYmd, monthRange, todayYmd, ymdToDb, type Ymd } from "@/lib/dates";
import { classifyCheckIn, dayType, nextWindow, resolveOpenWindow, windowFor, applyOverride, type DayWindow } from "@/server/services/attendance/window";
import { holidaySet, overrideResolver, rulesOf, scheduleFor, scheduleResolver } from "@/server/services/schedules";
import { getSettings, ipInAllowlist } from "@/server/services/settings";

export const ATTENDANCE_STATUSES: AttendanceStatus[] = ["PRESENT", "LATE", "ABSENT", "LEAVE", "HALF_DAY", "HOLIDAY", "WEEKLY_OFF"];

// ── Employee: today's status ──────────────────────────────────────────────────

export type TodayState =
  | { kind: "NO_SCHEDULE" }
  | { kind: "INACTIVE" }
  | { kind: "MARKED"; record: { status: AttendanceStatus; checkInAt: Date | null; attendanceDate: Ymd; minutesLate: number | null }; window: DayWindow | null }
  | { kind: "OPEN"; window: DayWindow; wouldBe: ReturnType<typeof classifyCheckIn> }
  | { kind: "CLOSED"; next: DayWindow | null; lastWindow: DayWindow | null; reason: "BEFORE_OPEN" | "AFTER_CLOSE" | "NON_WORKING" | "ON_LEAVE" };

export async function myTodayState(actor: Actor, now = new Date()): Promise<TodayState> {
  const employeeId = ownEmployeeId(actor);
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { isActive: true } });
  if (!emp.isActive) return { kind: "INACTIVE" };
  const settings = await getSettings();
  const today = todayYmd(settings.timezone, now);
  const schedule = await scheduleFor(prisma, employeeId, today);
  if (!schedule) return { kind: "NO_SCHEDULE" };
  const rules = rulesOf(schedule);
  const overrides = await overrideResolver(prisma, addDays(today, -1), addDays(today, 1));
  const holidays = await holidaySet(prisma, addDays(today, -1), addDays(today, 15));

  const open = resolveOpenWindow(rules, now, today, (ymd) => overrides(ymd, schedule.id));
  const candidate = open?.ymd ?? today;
  const existing = await prisma.attendanceRecord.findUnique({ where: { employeeId_attendanceDate: { employeeId, attendanceDate: ymdToDb(candidate) } } });
  if (existing && (existing.source === "SELF" || existing.source === "ADMIN" || existing.status === "LEAVE" || existing.status === "HOLIDAY" || existing.status === "WEEKLY_OFF" || open)) {
    return { kind: "MARKED", record: { status: existing.status, checkInAt: existing.checkInAt, attendanceDate: dbToYmd(existing.attendanceDate), minutesLate: existing.minutesLate }, window: open };
  }
  if (open) {
    const t = dayType(rules, open.ymd, holidays);
    if (t !== "WORKING") return { kind: "CLOSED", next: nextWindow(rules, now, today, holidays), lastWindow: open, reason: "NON_WORKING" };
    const onLeave = await prisma.leaveRequest.findFirst({ where: { employeeId, status: "APPROVED", startDate: { lte: ymdToDb(open.ymd) }, endDate: { gte: ymdToDb(open.ymd) } } });
    if (onLeave) return { kind: "CLOSED", next: nextWindow(rules, now, today, holidays), lastWindow: open, reason: "ON_LEAVE" };
    return { kind: "OPEN", window: open, wouldBe: classifyCheckIn(open, now) };
  }
  const todayWindow = windowFor(applyOverride(rules, overrides(today, schedule.id)), today);
  const isWorking = dayType(rules, today, holidays) === "WORKING";
  return {
    kind: "CLOSED",
    next: nextWindow(rules, now, today, holidays),
    lastWindow: todayWindow,
    reason: !isWorking ? "NON_WORKING" : now < todayWindow.opensAt ? "BEFORE_OPEN" : "AFTER_CLOSE",
  };
}

// ── Employee: mark attendance ─────────────────────────────────────────────────

export async function markAttendance(actor: Actor, meta: { ip: string | null; userAgent?: string | null }, now = new Date()) {
  const employeeId = ownEmployeeId(actor);
  const settings = await getSettings();
  if (!ipInAllowlist(meta.ip, settings.attendanceIpAllowlist)) {
    throw new AppError("Attendance can only be marked from the office network.", "IP_NOT_ALLOWED", 403);
  }
  const state = await myTodayState(actor, now);
  if (state.kind === "INACTIVE") throw new AppError("Your account is inactive.", "INACTIVE", 403);
  if (state.kind === "NO_SCHEDULE") throw new AppError("No work schedule is assigned to you. Please contact HR.", "NO_SCHEDULE", 409);
  if (state.kind === "MARKED") throw new ConflictError("Attendance for this working day has already been recorded.");
  if (state.kind === "CLOSED") {
    const msg =
      state.reason === "ON_LEAVE" ? "You are on approved leave for this working day."
      : state.reason === "NON_WORKING" ? "Today is not a scheduled working day."
      : state.reason === "BEFORE_OPEN" ? "The attendance window has not opened yet."
      : "The attendance window has closed. Please ask an administrator to correct your attendance.";
    throw new AppError(msg, "WINDOW_CLOSED", 409);
  }
  const { window, wouldBe } = state;
  try {
    const record = await prisma.$transaction(async (tx) => {
      const rec = await tx.attendanceRecord.create({
        data: {
          employeeId,
          attendanceDate: ymdToDb(window.ymd),
          status: wouldBe.status,
          checkInAt: now,
          minutesLate: wouldBe.minutesLate,
          source: "SELF",
          markedById: actor.userId,
          ipAddress: meta.ip,
        },
      });
      await audit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: "ATTENDANCE_MARK", entityType: "AttendanceRecord", entityId: rec.id, after: rec, ip: meta.ip, userAgent: meta.userAgent });
      return rec;
    });
    return record;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ConflictError("Attendance for this working day has already been recorded.");
    }
    throw e;
  }
}

// ── Employee: history & summary ───────────────────────────────────────────────

export async function myAttendance(actor: Actor, opts: { from?: Ymd; to?: Ymd; status?: AttendanceStatus; page?: number; pageSize?: number } = {}) {
  const employeeId = ownEmployeeId(actor);
  return listAttendanceFor(employeeId, opts);
}

export async function listAttendanceFor(employeeId: string, opts: { from?: Ymd; to?: Ymd; status?: AttendanceStatus; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 31));
  const where: Prisma.AttendanceRecordWhereInput = {
    employeeId,
    ...(opts.from || opts.to ? { attendanceDate: { ...(opts.from ? { gte: ymdToDb(opts.from) } : {}), ...(opts.to ? { lte: ymdToDb(opts.to) } : {}) } } : {}),
    ...(opts.status ? { status: opts.status } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.attendanceRecord.findMany({ where, orderBy: { attendanceDate: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { corrections: { orderBy: { correctedAt: "desc" }, take: 1 } } }),
    prisma.attendanceRecord.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export type MonthSummary = Record<AttendanceStatus, number> & { scheduledDays: number; recorded: number; pendingDays: number };

export async function monthSummaryFor(db: Db, employeeId: string, year: number, month: number, tz: string): Promise<MonthSummary> {
  const { start, end } = monthRange(year, month);
  const today = todayYmd(tz);
  await ensureFinalized(db, employeeId, start, minYmd(end, addDays(today, -1)));
  const rows = await db.attendanceRecord.groupBy({ by: ["status"], where: { employeeId, attendanceDate: { gte: ymdToDb(start), lte: ymdToDb(end) } }, _count: { _all: true } });
  const counts = Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s, 0])) as Record<AttendanceStatus, number>;
  for (const r of rows) counts[r.status] = r._count._all;
  const resolver = await scheduleResolver(db, employeeId);
  const holidays = await holidaySet(db, start, end);
  let scheduledDays = 0;
  for (const ymd of eachDay(start, end)) {
    const s = resolver(ymd);
    if (s && dayType(rulesOf(s), ymd, holidays) === "WORKING") scheduledDays++;
  }
  const recorded = Object.values(counts).reduce((a, b) => a + b, 0);
  return { ...counts, scheduledDays, recorded, pendingDays: Math.max(0, scheduledDays - (counts.PRESENT + counts.LATE + counts.HALF_DAY + counts.ABSENT + counts.LEAVE)) };
}

export async function myMonthSummary(actor: Actor, year: number, month: number) {
  const settings = await getSettings();
  return monthSummaryFor(prisma, ownEmployeeId(actor), year, month, settings.timezone);
}

// ── Finalization (system) ─────────────────────────────────────────────────────

/**
 * Materialise ABSENT / WEEKLY_OFF / HOLIDAY / LEAVE rows for every scheduled day in [from, to]
 * that has no record yet. Idempotent. Never touches existing rows.
 */
export async function ensureFinalized(db: Db, employeeId: string, from: Ymd, to: Ymd): Promise<number> {
  if (from > to) return 0;
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { joinedAt: true, terminatedAt: true } });
  if (!emp) return 0;
  const start = maxYmd(from, dbToYmd(emp.joinedAt));
  const end = emp.terminatedAt ? minYmd(to, dbToYmd(emp.terminatedAt)) : to;
  if (start > end) return 0;

  const [existing, resolver, holidays, leaves] = await Promise.all([
    db.attendanceRecord.findMany({ where: { employeeId, attendanceDate: { gte: ymdToDb(start), lte: ymdToDb(end) } }, select: { attendanceDate: true } }),
    scheduleResolver(db, employeeId),
    holidaySet(db, start, end),
    db.leaveRequest.findMany({ where: { employeeId, status: "APPROVED", startDate: { lte: ymdToDb(end) }, endDate: { gte: ymdToDb(start) } }, select: { id: true, startDate: true, endDate: true } }),
  ]);
  const have = new Set(existing.map((r) => dbToYmd(r.attendanceDate)));
  const rows: Prisma.AttendanceRecordCreateManyInput[] = [];
  for (const ymd of eachDay(start, end)) {
    if (have.has(ymd)) continue;
    const s: WorkSchedule | null = resolver(ymd);
    if (!s) continue;
    const t = dayType(rulesOf(s), ymd, holidays);
    const leave = leaves.find((l) => dbToYmd(l.startDate) <= ymd && dbToYmd(l.endDate) >= ymd);
    const status: AttendanceStatus = t === "HOLIDAY" ? "HOLIDAY" : t === "WEEKLY_OFF" ? "WEEKLY_OFF" : leave ? "LEAVE" : "ABSENT";
    rows.push({ employeeId, attendanceDate: ymdToDb(ymd), status, source: leave && status === "LEAVE" ? "LEAVE_APPROVAL" : "SYSTEM", leaveRequestId: status === "LEAVE" ? leave?.id : null });
  }
  if (!rows.length) return 0;
  const res = await db.attendanceRecord.createMany({ data: rows, skipDuplicates: true });
  return res.count;
}

/** Finalize all active employees up to yesterday (company timezone). Used by the nightly job. */
export async function finalizeAllUpToYesterday(now = new Date()): Promise<{ employees: number; created: number; through: Ymd }> {
  const settings = await getSettings();
  const yesterday = addDays(todayYmd(settings.timezone, now), -1);
  const from = addDays(yesterday, -45); // heal gaps if the job was down for a while
  const employees = await prisma.employee.findMany({ where: { isActive: true }, select: { id: true } });
  let created = 0;
  for (const e of employees) created += await ensureFinalized(prisma, e.id, from, yesterday);
  return { employees: employees.length, created, through: yesterday };
}

// ── Admin views ───────────────────────────────────────────────────────────────

export interface BoardRow {
  employee: { id: string; employeeCode: string; firstName: string; lastName: string; department: string | null };
  schedule: string | null;
  dayType: "WORKING" | "WEEKLY_OFF" | "HOLIDAY" | "NO_SCHEDULE";
  record: { id: string; status: AttendanceStatus; checkInAt: Date | null; minutesLate: number | null; source: string; note: string | null; isLocked: boolean } | null;
  window: DayWindow | null;
  derived: AttendanceStatus | "PENDING" | "NOT_MARKED";
}

/** Whole-company view for a date (today's board when date = today). */
export async function attendanceBoard(actor: Actor, ymd: Ymd, now = new Date()): Promise<BoardRow[]> {
  assertAdmin(actor);
  const [employees, records, holidays, overrides, leaves] = await Promise.all([
    prisma.employee.findMany({
      where: { isActive: true, joinedAt: { lte: ymdToDb(ymd) }, OR: [{ terminatedAt: null }, { terminatedAt: { gte: ymdToDb(ymd) } }] },
      select: { id: true, employeeCode: true, firstName: true, lastName: true, department: { select: { name: true } }, schedules: { include: { schedule: true }, orderBy: { effectiveFrom: "asc" } } },
      orderBy: { employeeCode: "asc" },
    }),
    prisma.attendanceRecord.findMany({ where: { attendanceDate: ymdToDb(ymd) } }),
    holidaySet(prisma, ymd, ymd),
    overrideResolver(prisma, ymd, ymd),
    prisma.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lte: ymdToDb(ymd) }, endDate: { gte: ymdToDb(ymd) } }, select: { employeeId: true } }),
  ]);
  const settings = await getSettings();
  const def = settings.defaultScheduleId ? await prisma.workSchedule.findUnique({ where: { id: settings.defaultScheduleId } }) : null;
  const onLeave = new Set(leaves.map((l) => l.employeeId));
  const byEmp = new Map(records.map((r) => [r.employeeId, r]));

  return employees.map((e) => {
    const a = e.schedules.find((s) => dbToYmd(s.effectiveFrom) <= ymd && (!s.effectiveTo || dbToYmd(s.effectiveTo) > ymd));
    const schedule = a?.schedule ?? def;
    const rec = byEmp.get(e.id) ?? null;
    let dt: BoardRow["dayType"] = "NO_SCHEDULE";
    let window: DayWindow | null = null;
    if (schedule) {
      dt = dayType(rulesOf(schedule), ymd, holidays);
      window = windowFor(applyOverride(rulesOf(schedule), overrides(ymd, schedule.id)), ymd);
    }
    let derived: BoardRow["derived"];
    if (rec) derived = rec.status;
    else if (dt === "HOLIDAY") derived = "HOLIDAY";
    else if (dt === "WEEKLY_OFF") derived = "WEEKLY_OFF";
    else if (onLeave.has(e.id)) derived = "LEAVE";
    else if (dt === "NO_SCHEDULE") derived = "NOT_MARKED";
    else if (window && now < window.closesAt) derived = "PENDING";
    else derived = "ABSENT";
    return {
      employee: { id: e.id, employeeCode: e.employeeCode, firstName: e.firstName, lastName: e.lastName, department: e.department?.name ?? null },
      schedule: schedule?.name ?? null,
      dayType: dt,
      record: rec ? { id: rec.id, status: rec.status, checkInAt: rec.checkInAt, minutesLate: rec.minutesLate, source: rec.source, note: rec.note, isLocked: rec.isLocked } : null,
      window,
      derived,
    };
  });
}

export async function adminListAttendance(actor: Actor, employeeId: string, opts: { from?: Ymd; to?: Ymd; status?: AttendanceStatus; page?: number; pageSize?: number }) {
  assertAdmin(actor);
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) throw new NotFoundError("Employee not found");
  const settings = await getSettings();
  if (opts.from && opts.to) await ensureFinalized(prisma, employeeId, opts.from, minYmd(opts.to, addDays(todayYmd(settings.timezone), -1)));
  return listAttendanceFor(employeeId, opts);
}

// ── Admin: manual correction ─────────────────────────────────────────────────

export interface CorrectionInput {
  employeeId: string;
  attendanceDate: Ymd;
  status: AttendanceStatus;
  checkInAt?: Date | null;
  reason: string;
}

export async function correctAttendance(actor: Actor, input: CorrectionInput, meta?: { ip?: string | null }) {
  assertAdmin(actor);
  if (!input.reason.trim()) throw new ValidationError("A reason is required", { reason: ["Required"] });
  const settings = await getSettings();
  if (input.attendanceDate > todayYmd(settings.timezone)) throw new ValidationError("Cannot record attendance for a future date", { attendanceDate: ["Future date"] });
  const emp = await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { id: true } });
  if (!emp) throw new NotFoundError("Employee not found");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.attendanceRecord.findUnique({ where: { employeeId_attendanceDate: { employeeId: input.employeeId, attendanceDate: ymdToDb(input.attendanceDate) } } });
    if (existing?.isLocked) throw new ConflictError("This day belongs to a finalized payroll period. Reopen the payroll run before correcting attendance.");

    const needsCheckIn = input.status === "PRESENT" || input.status === "LATE" || input.status === "HALF_DAY";
    let checkInAt = needsCheckIn ? (input.checkInAt ?? existing?.checkInAt ?? null) : null;
    let minutesLate: number | null = null;
    if (needsCheckIn) {
      const schedule = await scheduleFor(tx, input.employeeId, input.attendanceDate);
      if (schedule) {
        const w = windowFor(rulesOf(schedule), input.attendanceDate);
        if (!checkInAt) checkInAt = w.shiftStartAt;
        minutesLate = Math.max(0, Math.floor((checkInAt.getTime() - w.shiftStartAt.getTime()) / 60_000));
      }
    }
    const data = { status: input.status, checkInAt, minutesLate, source: "ADMIN" as const, markedById: actor.userId, note: input.reason.trim() };
    const rec = existing
      ? await tx.attendanceRecord.update({ where: { id: existing.id }, data })
      : await tx.attendanceRecord.create({ data: { ...data, employeeId: input.employeeId, attendanceDate: ymdToDb(input.attendanceDate) } });
    await tx.attendanceCorrection.create({
      data: {
        attendanceRecordId: rec.id,
        previousStatus: existing?.status ?? null,
        previousCheckInAt: existing?.checkInAt ?? null,
        newStatus: input.status,
        newCheckInAt: checkInAt,
        reason: input.reason.trim(),
        correctedById: actor.userId,
      },
    });
    await audit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: "ATTENDANCE_CORRECT", entityType: "AttendanceRecord", entityId: rec.id, before: existing, after: rec, ip: meta?.ip });
    return rec;
  });
}
