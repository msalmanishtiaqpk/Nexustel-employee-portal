/**
 * Database-backed tests for role isolation and the attendance → leave → payroll flow.
 * Runs against DATABASE_URL_TEST (see vitest.config.ts). Every test starts from a clean schema.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import type { Actor } from "@/server/auth/actor";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import { ymdToDb, addDays } from "@/lib/dates";

const prisma = new PrismaClient();

// Services (imported after env is set by vitest config)
import { markAttendance, myAttendance, myTodayState, ensureFinalized, correctAttendance, adminListAttendance } from "@/server/services/attendance";
import { getEmployee, getMyProfile, listEmployees, updateMyContactInfo } from "@/server/services/employees";
import { submitLeaveRequest, reviewLeaveRequest, cancelMyLeaveRequest, myLeaveRequests, balancesFor } from "@/server/services/leave";
import { runPayroll, finalizeRun, reopenRun, getMyPayslip, myPayslips, adminGetPayslip, getRun } from "@/server/services/payroll/run";
import { attendanceReport } from "@/server/services/reports";

const TZ = "Asia/Karachi";
const pkt = (s: string) => new Date(`${s}+05:00`);

let admin: Actor, alice: Actor, bob: Actor;
let aliceId: string, bobId: string, adminUserId: string;

async function resetDb() {
  const tables = ["audit_logs", "payroll_adjustments", "payslips", "payroll_runs", "payroll_policies", "attendance_corrections", "attendance_records", "leave_requests", "leave_balances", "leave_types", "attendance_window_overrides", "holidays", "employee_schedules", "employee_salaries", "salary_components", "company_settings", "employees", "sessions", "password_reset_tokens", "users", "departments", "work_schedules"];
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

async function mkUser(email: string, role: "ADMIN" | "EMPLOYEE", code: string, joined: string, salary = "66000") {
  const user = await prisma.user.create({ data: { email, passwordHash: "x", role, mustChangePassword: false } });
  const emp = await prisma.employee.create({ data: { userId: user.id, employeeCode: code, firstName: code, lastName: role, joinedAt: ymdToDb(joined) } });
  await prisma.employeeSalary.create({ data: { employeeId: emp.id, baseSalary: new Prisma.Decimal(salary), effectiveFrom: ymdToDb(joined), createdById: user.id } });
  const actor: Actor = { userId: user.id, role, email, employeeId: emp.id, mustChangePassword: false, sessionId: "s" };
  return { user, emp, actor };
}

beforeAll(async () => {
  await resetDb();
  const day = await prisma.workSchedule.create({ data: { name: "Day", timezone: TZ, shiftStartMin: 540, shiftEndMin: 1080, workingDays: [1, 2, 3, 4, 5], checkinOpensMinBefore: 60, lateAfterMin: 15, halfDayAfterMin: 240, checkinClosesAfterMin: 480 } });
  await prisma.companySettings.create({ data: { id: 1, timezone: TZ, currency: "PKR", defaultScheduleId: day.id } });
  const a = await mkUser("admin@test.local", "ADMIN", "NT-0001", "2025-01-01");
  const al = await mkUser("alice@test.local", "EMPLOYEE", "NT-0002", "2025-01-01");
  const bo = await mkUser("bob@test.local", "EMPLOYEE", "NT-0003", "2025-01-01");
  admin = a.actor; alice = al.actor; bob = bo.actor; aliceId = al.emp.id; bobId = bo.emp.id; adminUserId = a.user.id;
  await prisma.leaveType.createMany({ data: [
    { name: "Annual", code: "ANNUAL", isPaid: true, annualQuotaDays: new Prisma.Decimal(14) },
    { name: "Unpaid", code: "UNPAID", isPaid: false, annualQuotaDays: null },
  ] });
  await prisma.payrollPolicy.create({ data: { name: "Std", effectiveFrom: ymdToDb("2025-01-01"), createdById: adminUserId } });
  await prisma.holiday.create({ data: { date: ymdToDb("2026-08-14"), name: "Independence Day" } });
});

describe("role-based access control and data isolation", () => {
  it("employees cannot call admin services", async () => {
    await expect(listEmployees(alice)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getEmployee(alice, bobId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(adminListAttendance(alice, bobId, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runPayroll(alice, 2026, 8)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(attendanceReport(alice, { from: "2026-08-01", to: "2026-08-31" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(adminGetPayslip(alice, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("employee-scoped services are bound to the session's employee id", async () => {
    const me = await getMyProfile(alice);
    expect(me.id).toBe(aliceId);
    await updateMyContactInfo(alice, { phone: "0300-1234567" });
    expect((await prisma.employee.findUnique({ where: { id: aliceId } }))?.phone).toBe("0300-1234567");
    expect((await prisma.employee.findUnique({ where: { id: bobId } }))?.phone).toBeNull();
  });

  it("an employee cannot see or cancel another employee's leave request (404, not 403)", async () => {
    const req = await prisma.leaveRequest.create({ data: { employeeId: bobId, leaveTypeId: (await prisma.leaveType.findUniqueOrThrow({ where: { code: "ANNUAL" } })).id, startDate: ymdToDb("2026-12-01"), endDate: ymdToDb("2026-12-01"), workingDays: new Prisma.Decimal(1), reason: "x" } });
    await expect(cancelMyLeaveRequest(alice, req.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await myLeaveRequests(alice)).map((r) => r.id)).not.toContain(req.id);
    await prisma.leaveRequest.delete({ where: { id: req.id } });
  });

  it("a user with no employee profile cannot use employee services", async () => {
    const orphan: Actor = { ...alice, employeeId: null };
    await expect(myTodayState(orphan)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("attendance marking", () => {
  const monday = "2026-08-03";
  it("records PRESENT inside the window and refuses a second mark", async () => {
    const now = pkt(`${monday}T09:05:00`);
    const rec = await markAttendance(alice, { ip: "10.0.0.1" }, now);
    expect(rec.status).toBe("PRESENT");
    expect(rec.minutesLate).toBe(5);
    await expect(markAttendance(alice, { ip: "10.0.0.1" }, pkt(`${monday}T09:10:00`))).rejects.toBeInstanceOf(ConflictError);
    const mine = await myAttendance(alice, { from: monday, to: monday });
    expect(mine.items).toHaveLength(1);
    const bobs = await myAttendance(bob, { from: monday, to: monday });
    expect(bobs.items).toHaveLength(0);
  });

  it("classifies LATE and HALF_DAY and refuses outside the window", async () => {
    const tue = "2026-08-04";
    expect((await markAttendance(bob, { ip: null }, pkt(`${tue}T09:40:00`))).status).toBe("LATE");
    const wed = "2026-08-05";
    expect((await markAttendance(alice, { ip: null }, pkt(`${wed}T13:30:00`))).status).toBe("HALF_DAY");
    const thu = "2026-08-06";
    const err = await markAttendance(alice, { ip: null }, pkt(`${thu}T18:30:00`)).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("WINDOW_CLOSED");
    const sat = "2026-08-08";
    const err2 = await markAttendance(alice, { ip: null }, pkt(`${sat}T09:00:00`)).catch((e) => e);
    expect((err2 as AppError).code).toBe("WINDOW_CLOSED");
  });

  it("honours the office IP allowlist", async () => {
    await prisma.companySettings.update({ where: { id: 1 }, data: { attendanceIpAllowlist: ["203.0.113.0/24"] } });
    const err = await markAttendance(bob, { ip: "198.51.100.7" }, pkt("2026-08-06T09:00:00")).catch((e) => e);
    expect((err as AppError).code).toBe("IP_NOT_ALLOWED");
    expect((await markAttendance(bob, { ip: "203.0.113.44" }, pkt("2026-08-06T09:00:00"))).status).toBe("PRESENT");
    await prisma.companySettings.update({ where: { id: 1 }, data: { attendanceIpAllowlist: [] } });
  });

  it("finalization materialises ABSENT, WEEKLY_OFF and HOLIDAY without touching existing rows", async () => {
    const created = await ensureFinalized(prisma, alice.employeeId!, "2026-08-01", "2026-08-31");
    expect(created).toBe(31 - 2); // 31 days minus the 2 already recorded (3 Aug, 5 Aug)
    const rows = await prisma.attendanceRecord.findMany({ where: { employeeId: aliceId, attendanceDate: { gte: ymdToDb("2026-08-01"), lte: ymdToDb("2026-08-31") } } });
    const by = (d: string) => rows.find((r) => r.attendanceDate.toISOString().startsWith(d))?.status;
    expect(by("2026-08-03")).toBe("PRESENT");
    expect(by("2026-08-01")).toBe("WEEKLY_OFF"); // Saturday
    expect(by("2026-08-14")).toBe("HOLIDAY");
    expect(by("2026-08-06")).toBe("ABSENT");
    expect(await ensureFinalized(prisma, alice.employeeId!, "2026-08-01", "2026-08-31")).toBe(0); // idempotent
  });

  it("admin corrections are audited and keep the previous value", async () => {
    await correctAttendance(admin, { employeeId: aliceId, attendanceDate: "2026-08-06", status: "PRESENT", reason: "Was on client call" });
    const rec = await prisma.attendanceRecord.findUniqueOrThrow({ where: { employeeId_attendanceDate: { employeeId: aliceId, attendanceDate: ymdToDb("2026-08-06") } }, include: { corrections: true } });
    expect(rec.status).toBe("PRESENT");
    expect(rec.source).toBe("ADMIN");
    expect(rec.corrections[0].previousStatus).toBe("ABSENT");
    await expect(correctAttendance(alice, { employeeId: bobId, attendanceDate: "2026-08-06", status: "PRESENT", reason: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("leave", () => {
  it("submit → approve writes LEAVE attendance for working days only and updates balances", async () => {
    const annual = await prisma.leaveType.findUniqueOrThrow({ where: { code: "ANNUAL" } });
    const today = new Date().toISOString().slice(0, 10);
    const start = addDays(today, 30); // future, safely beyond notice rules
    // find next Friday from start so the range Fri..Mon spans a weekend
    let fri = start;
    while (new Date(`${fri}T00:00:00Z`).getUTCDay() !== 5) fri = addDays(fri, 1);
    const mon = addDays(fri, 3);
    const req = await submitLeaveRequest(alice, { leaveTypeId: annual.id, startDate: fri, endDate: mon, isHalfDay: false, reason: "Trip" });
    expect(req.workingDays.toString()).toBe("2");
    // overlap is rejected by the exclusion constraint
    await expect(submitLeaveRequest(alice, { leaveTypeId: annual.id, startDate: mon, endDate: mon, isHalfDay: false, reason: "dup" })).rejects.toBeInstanceOf(ConflictError);
    await expect(reviewLeaveRequest(alice, req.id, "APPROVED", null)).rejects.toBeInstanceOf(ForbiddenError);
    await reviewLeaveRequest(admin, req.id, "APPROVED", "Enjoy");
    const rows = await prisma.attendanceRecord.findMany({ where: { employeeId: aliceId, leaveRequestId: req.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "LEAVE")).toBe(true);
    const bal = (await balancesFor(prisma, aliceId, Number(fri.slice(0, 4)))).find((b) => b.leaveType.code === "ANNUAL")!;
    expect(bal.used.toString()).toBe("2");
    expect(bal.remaining?.toString()).toBe("12");
    // employee can cancel a future approved request; LEAVE rows are removed
    await cancelMyLeaveRequest(alice, req.id);
    expect(await prisma.attendanceRecord.count({ where: { leaveRequestId: req.id } })).toBe(0);
  });

  it("rejects requests exceeding the balance", async () => {
    const annual = await prisma.leaveType.findUniqueOrThrow({ where: { code: "ANNUAL" } });
    const today = new Date().toISOString().slice(0, 10);
    const start = addDays(today, 40);
    await expect(submitLeaveRequest(bob, { leaveTypeId: annual.id, startDate: start, endDate: addDays(start, 30), isHalfDay: false, reason: "too long" })).rejects.toThrow(/Insufficient|calendar years/);
  });
});

describe("payroll", () => {
  it("runs, finalizes (locking attendance), and reopens", async () => {
    // Alice, August 2026: 21 scheduled days (Mon–Fri) incl. 1 holiday. Records: PRESENT 3 Aug, HALF_DAY 5 Aug, PRESENT 6 Aug (corrected), rest ABSENT.
    await ensureFinalized(prisma, bobId, "2026-08-01", "2026-08-31");
    const { run } = await runPayroll(admin, 2026, 8);
    expect(run.status).toBe("DRAFT");
    const detail = (await getRun(admin, 2026, 8))!;
    const alicePs = detail.payslips.find((p) => p.employeeId === aliceId)!;
    expect(alicePs.workingDays).toBe(21);
    expect(alicePs.holidayDays).toBe(1);
    expect(alicePs.presentDays).toBe(2);
    expect(alicePs.halfDays).toBe(1);
    expect(alicePs.absentDays).toBe(17); // 21 - 1 holiday - 2 present - 1 half
    // per-day 66000/21 = 3142.857…; deduction = (17 + 0.5) × rate = 55000; net = 11000
    expect(alicePs.netPay.toString()).toBe("11000");

    // Drafts are invisible to employees; finalized ones are not.
    await expect(getMyPayslip(alice, alicePs.id)).rejects.toBeInstanceOf(NotFoundError);
    await finalizeRun(admin, run.id);
    const mine = await myPayslips(alice);
    expect(mine.map((p) => p.id)).toContain(alicePs.id);
    expect(mine[0].payslipNumber).toMatch(/^NT-2026-08-\d{4}$/);
    // Bob must never see Alice's payslip
    await expect(getMyPayslip(bob, alicePs.id)).rejects.toBeInstanceOf(NotFoundError);
    // Attendance is locked
    await expect(correctAttendance(admin, { employeeId: aliceId, attendanceDate: "2026-08-10", status: "PRESENT", reason: "late fix" })).rejects.toBeInstanceOf(ConflictError);
    await expect(runPayroll(admin, 2026, 8)).rejects.toBeInstanceOf(ConflictError);
    // Reopen unlocks and allows a re-run that supersedes
    await reopenRun(admin, run.id, "Correction needed");
    await correctAttendance(admin, { employeeId: aliceId, attendanceDate: "2026-08-10", status: "PRESENT", reason: "late fix" });
    await runPayroll(admin, 2026, 8);
    const again = (await getRun(admin, 2026, 8))!;
    expect(again.status).toBe("REOPENED");
    expect(again.payslips.find((p) => p.employeeId === aliceId)!.netPay.toString()).toBe("14143"); // (16.5 × 3142.857) deducted → 14142.86 → 14143
    expect(await prisma.payslip.count({ where: { payrollRunId: run.id, supersededAt: { not: null } } })).toBe(3); // admin, alice, bob
  });
});
