import { prisma, type Db } from "@/server/db";
import type { Actor } from "@/server/auth/actor";
import { assertAdmin } from "@/server/auth/actor";
import { audit } from "@/server/services/audit";
import { NotFoundError, ValidationError, ConflictError } from "@/server/errors";
import { dbToYmd, ymdToDb, type Ymd } from "@/lib/dates";
import { validateRules, type ScheduleRules, type WindowOverride } from "@/server/services/attendance/window";
import { getSettings } from "@/server/services/settings";
import type { WorkSchedule } from "@prisma/client";

export interface ScheduleInput extends ScheduleRules {
  name: string;
  isActive?: boolean;
}

export async function listSchedules(includeInactive = true) {
  return prisma.workSchedule.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { name: "asc" }, include: { _count: { select: { assignments: true } } } });
}

export async function getSchedule(id: string) {
  const s = await prisma.workSchedule.findUnique({ where: { id } });
  if (!s) throw new NotFoundError("Schedule not found");
  return s;
}

export async function createSchedule(actor: Actor, input: ScheduleInput) {
  assertAdmin(actor);
  const errs = validateRules(input);
  if (errs.length) throw new ValidationError(errs.join(". "), { _: errs });
  if (await prisma.workSchedule.findUnique({ where: { name: input.name.trim() } })) throw new ValidationError("A schedule with this name exists", { name: ["Already exists"] });
  const s = await prisma.workSchedule.create({ data: { ...input, name: input.name.trim(), workingDays: [...input.workingDays].sort() } });
  await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: "CREATE", entityType: "WorkSchedule", entityId: s.id, after: s });
  return s;
}

export async function updateSchedule(actor: Actor, id: string, input: ScheduleInput) {
  assertAdmin(actor);
  const errs = validateRules(input);
  if (errs.length) throw new ValidationError(errs.join(". "), { _: errs });
  const before = await getSchedule(id);
  const dupe = await prisma.workSchedule.findUnique({ where: { name: input.name.trim() } });
  if (dupe && dupe.id !== id) throw new ValidationError("A schedule with this name exists", { name: ["Already exists"] });
  const after = await prisma.workSchedule.update({ where: { id }, data: { ...input, name: input.name.trim(), workingDays: [...input.workingDays].sort() } });
  await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: "UPDATE", entityType: "WorkSchedule", entityId: id, before, after });
  return after;
}

export function rulesOf(s: WorkSchedule): ScheduleRules {
  return {
    timezone: s.timezone,
    shiftStartMin: s.shiftStartMin,
    shiftEndMin: s.shiftEndMin,
    workingDays: s.workingDays,
    checkinOpensMinBefore: s.checkinOpensMinBefore,
    lateAfterMin: s.lateAfterMin,
    halfDayAfterMin: s.halfDayAfterMin,
    checkinClosesAfterMin: s.checkinClosesAfterMin,
  };
}

/**
 * Resolve the schedule in effect for an employee on a date: the effective-dated assignment,
 * else the company default schedule, else null (no attendance possible).
 */
export async function scheduleFor(db: Db, employeeId: string, ymd: Ymd): Promise<WorkSchedule | null> {
  const d = ymdToDb(ymd);
  const a = await db.employeeSchedule.findFirst({
    where: { employeeId, effectiveFrom: { lte: d }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: d } }] },
    include: { schedule: true },
    orderBy: { effectiveFrom: "desc" },
  });
  if (a) return a.schedule;
  const settings = await getSettings();
  if (!settings.defaultScheduleId) return null;
  return db.workSchedule.findUnique({ where: { id: settings.defaultScheduleId } });
}

/** Resolver for a date range: returns a function ymd -> schedule using the employee's assignment history. */
export async function scheduleResolver(db: Db, employeeId: string): Promise<(ymd: Ymd) => WorkSchedule | null> {
  const [assignments, settings] = await Promise.all([
    db.employeeSchedule.findMany({ where: { employeeId }, include: { schedule: true }, orderBy: { effectiveFrom: "asc" } }),
    getSettings(),
  ]);
  const def = settings.defaultScheduleId ? await db.workSchedule.findUnique({ where: { id: settings.defaultScheduleId } }) : null;
  return (ymd) => {
    for (let i = assignments.length - 1; i >= 0; i--) {
      const a = assignments[i];
      const from = dbToYmd(a.effectiveFrom);
      const to = a.effectiveTo ? dbToYmd(a.effectiveTo) : null;
      if (ymd >= from && (to === null || ymd < to)) return a.schedule;
    }
    return def;
  };
}

// ── Holidays ─────────────────────────────────────────────────────────────────

export async function listHolidays(year?: number) {
  return prisma.holiday.findMany({
    where: year ? { date: { gte: ymdToDb(`${year}-01-01`), lte: ymdToDb(`${year}-12-31`) } } : {},
    orderBy: { date: "asc" },
  });
}

export async function holidaySet(db: Db, from: Ymd, to: Ymd): Promise<Set<Ymd>> {
  const rows = await db.holiday.findMany({ where: { date: { gte: ymdToDb(from), lte: ymdToDb(to) } }, select: { date: true } });
  return new Set(rows.map((r) => dbToYmd(r.date)));
}

export async function createHoliday(actor: Actor, date: Ymd, name: string, isPaid: boolean) {
  assertAdmin(actor);
  if (await prisma.holiday.findUnique({ where: { date: ymdToDb(date) } })) throw new ConflictError("A holiday already exists on that date");
  const h = await prisma.holiday.create({ data: { date: ymdToDb(date), name: name.trim(), isPaid } });
  await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: "CREATE", entityType: "Holiday", entityId: h.id, after: h });
  return h;
}

export async function deleteHoliday(actor: Actor, id: string) {
  assertAdmin(actor);
  const h = await prisma.holiday.findUnique({ where: { id } });
  if (!h) throw new NotFoundError("Holiday not found");
  await prisma.holiday.delete({ where: { id } });
  await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: "DELETE", entityType: "Holiday", entityId: id, before: h });
}

// ── Window overrides ─────────────────────────────────────────────────────────

export async function listOverrides(from: Ymd, to: Ymd) {
  return prisma.attendanceWindowOverride.findMany({ where: { date: { gte: ymdToDb(from), lte: ymdToDb(to) } }, include: { schedule: { select: { name: true } } }, orderBy: { date: "asc" } });
}

export async function overrideResolver(db: Db, from: Ymd, to: Ymd): Promise<(ymd: Ymd, scheduleId: string) => WindowOverride | null> {
  const rows = await db.attendanceWindowOverride.findMany({ where: { date: { gte: ymdToDb(from), lte: ymdToDb(to) } } });
  return (ymd, scheduleId) => rows.find((r) => dbToYmd(r.date) === ymd && r.scheduleId === scheduleId) ?? rows.find((r) => dbToYmd(r.date) === ymd && r.scheduleId === null) ?? null;
}

export async function createOverride(actor: Actor, input: { date: Ymd; scheduleId: string | null; reason: string | null } & WindowOverride) {
  assertAdmin(actor);
  const o = await prisma.attendanceWindowOverride.upsert({
    where: { date_scheduleId: { date: ymdToDb(input.date), scheduleId: input.scheduleId as string } },
    create: { ...input, date: ymdToDb(input.date), createdById: actor.userId },
    update: { ...input, date: ymdToDb(input.date), createdById: actor.userId },
  }).catch(async () => {
    // Prisma's compound unique with a NULL member cannot be matched by upsert; fall back to delete+create.
    await prisma.attendanceWindowOverride.deleteMany({ where: { date: ymdToDb(input.date), scheduleId: input.scheduleId } });
    return prisma.attendanceWindowOverride.create({ data: { ...input, date: ymdToDb(input.date), createdById: actor.userId } });
  });
  await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: "CREATE", entityType: "AttendanceWindowOverride", entityId: o.id, after: o });
  return o;
}

export async function deleteOverride(actor: Actor, id: string) {
  assertAdmin(actor);
  const o = await prisma.attendanceWindowOverride.findUnique({ where: { id } });
  if (!o) throw new NotFoundError("Override not found");
  await prisma.attendanceWindowOverride.delete({ where: { id } });
  await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: "DELETE", entityType: "AttendanceWindowOverride", entityId: id, before: o });
}
