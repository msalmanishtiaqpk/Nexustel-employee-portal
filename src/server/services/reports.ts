import ExcelJS from "exceljs";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/auth/actor";
import { assertAdmin } from "@/server/auth/actor";
import { audit } from "@/server/services/audit";
import { NotFoundError, ValidationError } from "@/server/errors";
import { addDays, dbToYmd, daysBetweenInclusive, formatInstant, minYmd, todayYmd, ymdToDb, type Ymd } from "@/lib/dates";
import { ensureFinalized } from "@/server/services/attendance";
import { getSettings } from "@/server/services/settings";

export type ExportFormat = "csv" | "xlsx";

export interface Table {
  name: string;
  columns: string[];
  rows: (string | number | null)[][];
}

export function toCsv(t: Table): string {
  const esc = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [t.columns.map(esc).join(","), ...t.rows.map((r) => r.map(esc).join(","))].join("\r\n") + "\r\n";
}

export async function toXlsx(tables: Table[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Nexus-Tel Employee Portal";
  for (const t of tables) {
    const ws = wb.addWorksheet(t.name.slice(0, 31));
    ws.addRow(t.columns);
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
    for (const r of t.rows) ws.addRow(r.map((v) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && v.length < 15 ? Number(v) : v)));
    ws.columns.forEach((c) => { c.width = Math.min(40, Math.max(12, ...(c.values ?? []).map((v) => String(v ?? "").length + 2))); });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function attendanceReport(actor: Actor, f: { from: Ymd; to: Ymd; employeeId?: string | null; departmentId?: string | null }, meta?: { ip?: string | null }): Promise<Table> {
  assertAdmin(actor);
  if (f.to < f.from) throw new ValidationError("End date must be after start date");
  if (daysBetweenInclusive(f.from, f.to) > 366) throw new ValidationError("Range may not exceed one year");
  const settings = await getSettings();
  const through = minYmd(f.to, addDays(todayYmd(settings.timezone), -1));
  const employees = await prisma.employee.findMany({
    where: { ...(f.employeeId ? { id: f.employeeId } : {}), ...(f.departmentId ? { departmentId: f.departmentId } : {}), joinedAt: { lte: ymdToDb(f.to) } },
    select: { id: true, employeeCode: true, firstName: true, lastName: true, department: { select: { name: true } } },
    orderBy: { employeeCode: "asc" },
  });
  for (const e of employees) await ensureFinalized(prisma, e.id, f.from, through);
  const records = await prisma.attendanceRecord.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) }, attendanceDate: { gte: ymdToDb(f.from), lte: ymdToDb(f.to) } },
    include: { leaveRequest: { select: { leaveType: { select: { name: true } } } } },
    orderBy: [{ attendanceDate: "asc" }],
  });
  const byEmp = new Map(employees.map((e) => [e.id, e]));
  const rows = records.map((r) => {
    const e = byEmp.get(r.employeeId)!;
    return [dbToYmd(r.attendanceDate), e.employeeCode, `${e.firstName} ${e.lastName}`, e.department?.name ?? "", r.status, r.checkInAt ? formatInstant(r.checkInAt, settings.timezone, "yyyy-MM-dd HH:mm") : "", r.minutesLate ?? "", r.source, r.leaveRequest?.leaveType.name ?? "", r.note ?? "", r.isLocked ? "yes" : "no"];
  });
  await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: "EXPORT", entityType: "AttendanceReport", after: { ...f, rows: rows.length }, ip: meta?.ip });
  return { name: "Attendance", columns: ["Date", "Employee code", "Employee", "Department", "Status", "Check-in", "Minutes late", "Source", "Leave type", "Note", "Locked"], rows };
}

export async function attendanceSummaryReport(actor: Actor, f: { from: Ymd; to: Ymd; departmentId?: string | null }): Promise<Table> {
  assertAdmin(actor);
  const settings = await getSettings();
  const through = minYmd(f.to, addDays(todayYmd(settings.timezone), -1));
  const employees = await prisma.employee.findMany({ where: { ...(f.departmentId ? { departmentId: f.departmentId } : {}), joinedAt: { lte: ymdToDb(f.to) } }, select: { id: true, employeeCode: true, firstName: true, lastName: true, department: { select: { name: true } } }, orderBy: { employeeCode: "asc" } });
  for (const e of employees) await ensureFinalized(prisma, e.id, f.from, through);
  const grouped = await prisma.attendanceRecord.groupBy({ by: ["employeeId", "status"], where: { employeeId: { in: employees.map((e) => e.id) }, attendanceDate: { gte: ymdToDb(f.from), lte: ymdToDb(f.to) } }, _count: { _all: true } });
  const rows = employees.map((e) => {
    const c = (s: string) => grouped.find((g) => g.employeeId === e.id && g.status === s)?._count._all ?? 0;
    return [e.employeeCode, `${e.firstName} ${e.lastName}`, e.department?.name ?? "", c("PRESENT"), c("LATE"), c("HALF_DAY"), c("ABSENT"), c("LEAVE"), c("HOLIDAY"), c("WEEKLY_OFF")];
  });
  return { name: "Summary", columns: ["Employee code", "Employee", "Department", "Present", "Late", "Half day", "Absent", "Leave", "Holiday", "Weekly off"], rows };
}

export async function payrollRegister(actor: Actor, year: number, month: number, meta?: { ip?: string | null }): Promise<Table> {
  assertAdmin(actor);
  const run = await prisma.payrollRun.findUnique({ where: { periodYear_periodMonth: { periodYear: year, periodMonth: month } }, include: { payslips: { where: { supersededAt: null }, include: { employee: { select: { employeeCode: true, firstName: true, lastName: true, department: { select: { name: true } }, bankName: true, bankAccountTitle: true, bankAccountLast4: true } } }, orderBy: { employee: { employeeCode: "asc" } } } } });
  if (!run) throw new NotFoundError("No payroll run for that period");
  const rows = run.payslips.map((p) => [
    p.payslipNumber ?? "DRAFT", p.employee.employeeCode, `${p.employee.firstName} ${p.employee.lastName}`, p.employee.department?.name ?? "",
    (p.salarySnapshot as { baseSalary: string }).baseSalary, p.workingDays, p.payableDays.toString(), p.presentDays, p.lateDays, p.halfDays, p.absentDays, p.paidLeaveDays.toString(), p.unpaidLeaveDays.toString(),
    p.perDayRate.toString(), p.baseEarned.toString(), p.componentsEarned.toString(), p.bonusesTotal.toString(), p.attendanceDeduction.toString(), p.lateDeduction.toString(), p.componentsDeducted.toString(), p.deductionsTotal.toString(),
    p.grossPay.toString(), p.netPay.toString(), p.currency, p.employee.bankName ?? "", p.employee.bankAccountTitle ?? "", p.employee.bankAccountLast4 ? `••••${p.employee.bankAccountLast4}` : "",
  ]);
  await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: "EXPORT", entityType: "PayrollRegister", entityId: run.id, after: { year, month, rows: rows.length }, ip: meta?.ip });
  return {
    name: `Payroll ${year}-${String(month).padStart(2, "0")}`,
    columns: ["Payslip no.", "Employee code", "Employee", "Department", "Base salary", "Working days", "Payable days", "Present", "Late", "Half day", "Absent", "Paid leave", "Unpaid leave", "Per-day rate", "Base earned", "Allowances", "Bonuses", "Attendance deduction", "Late deduction", "Recurring deductions", "Other deductions", "Gross pay", "Net pay", "Currency", "Bank", "Account title", "Account (last 4)"],
    rows,
  };
}
