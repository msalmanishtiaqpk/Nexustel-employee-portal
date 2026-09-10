import { PrismaClient, Prisma, type AttendanceStatus } from "@prisma/client";
import { hash } from "@node-rs/argon2";

const prisma = new PrismaClient();

const TZ = "Asia/Karachi";
const ymd = (s: string) => new Date(`${s}T00:00:00.000Z`);
const toYmd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => toYmd(new Date(ymd(s).getTime() + n * 86_400_000));
const isoWeekday = (s: string) => { const d = ymd(s).getUTCDay(); return d === 0 ? 7 : d; };
const todayYmd = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// Deterministic PRNG so demo data is stable between resets.
let seedState = 42;
const rand = () => { seedState = (seedState * 1103515245 + 12345) & 0x7fffffff; return seedState / 0x7fffffff; };

async function main() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@nexus-tel.com").toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe!2026";
  const demo = (process.env.SEED_DEMO_DATA ?? "false") === "true";

  // ── Company settings & schedules ─────────────────────────────────────────
  const daySchedule = await prisma.workSchedule.upsert({
    where: { name: "Day shift (9:00–18:00, Mon–Fri)" },
    update: {},
    create: { name: "Day shift (9:00–18:00, Mon–Fri)", timezone: TZ, shiftStartMin: 9 * 60, shiftEndMin: 18 * 60, workingDays: [1, 2, 3, 4, 5], checkinOpensMinBefore: 60, lateAfterMin: 15, halfDayAfterMin: 240, checkinClosesAfterMin: 480 },
  });
  const nightSchedule = await prisma.workSchedule.upsert({
    where: { name: "US night shift (20:00–05:00, Mon–Sat)" },
    update: {},
    create: { name: "US night shift (20:00–05:00, Mon–Sat)", timezone: TZ, shiftStartMin: 20 * 60, shiftEndMin: 5 * 60, workingDays: [1, 2, 3, 4, 5, 6], checkinOpensMinBefore: 60, lateAfterMin: 15, halfDayAfterMin: 240, checkinClosesAfterMin: 480 },
  });
  await prisma.companySettings.upsert({
    where: { id: 1 },
    update: { defaultScheduleId: daySchedule.id },
    create: { id: 1, companyName: "Nexus-Tel", timezone: TZ, currency: "PKR", defaultScheduleId: daySchedule.id, payslipFooter: "Nexus-Tel · 717 Jinnah Street, C Block, Faisal Town, Lahore · nexus-tel.com" },
  });

  // ── Admin ────────────────────────────────────────────────────────────────
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: { email: adminEmail, passwordHash: await hash(adminPassword, { memoryCost: 65536, timeCost: 3, parallelism: 1 }), role: "ADMIN", mustChangePassword: true },
  });
  const hr = await prisma.department.upsert({ where: { name: "Human Resources" }, update: {}, create: { name: "Human Resources" } });
  await prisma.employee.upsert({
    where: { userId: admin.id },
    update: {},
    create: { userId: admin.id, employeeCode: "NT-0001", firstName: "Portal", lastName: "Administrator", designation: "HR Administrator", departmentId: hr.id, employmentType: "FULL_TIME", joinedAt: ymd("2024-01-01") },
  });

  // ── Leave types ──────────────────────────────────────────────────────────
  const leaveTypes = [
    { name: "Annual leave", code: "ANNUAL", isPaid: true, annualQuotaDays: "14", minNoticeDays: 3, allowHalfDay: false },
    { name: "Sick leave", code: "SICK", isPaid: true, annualQuotaDays: "8", minNoticeDays: 0, allowHalfDay: true },
    { name: "Casual leave", code: "CASUAL", isPaid: true, annualQuotaDays: "10", minNoticeDays: 1, allowHalfDay: true },
    { name: "Unpaid leave", code: "UNPAID", isPaid: false, annualQuotaDays: null, minNoticeDays: 0, allowHalfDay: false },
  ];
  for (const lt of leaveTypes) {
    await prisma.leaveType.upsert({ where: { code: lt.code }, update: {}, create: { ...lt, annualQuotaDays: lt.annualQuotaDays ? new Prisma.Decimal(lt.annualQuotaDays) : null } });
  }

  // ── Payroll policy ───────────────────────────────────────────────────────
  await prisma.payrollPolicy.upsert({
    where: { effectiveFrom: ymd("2024-01-01") },
    update: {},
    create: {
      name: "Standard policy", effectiveFrom: ymd("2024-01-01"), salaryBasis: "WORKING_DAYS", countHolidaysAsPaid: true, countWeeklyOffAsPaid: true,
      absentDeductionDays: new Prisma.Decimal("1"), halfDayDeductionDays: new Prisma.Decimal("0.5"), unpaidLeaveDeductionDays: new Prisma.Decimal("1"),
      latePenaltyMode: "LATES_TO_ABSENT", latesPerAbsent: 3, lateGraceCount: 0, prorateNewJoiners: true, roundingMode: "HALF_UP", roundingPrecision: 0, currency: "PKR", createdById: admin.id,
    },
  });

  // ── Public holidays (Pakistan, 2026 — verify against the official gazette) ─
  const holidays: [string, string][] = [
    ["2026-02-05", "Kashmir Day"], ["2026-03-20", "Eid ul-Fitr"], ["2026-03-21", "Eid ul-Fitr"], ["2026-03-23", "Pakistan Day"],
    ["2026-05-01", "Labour Day"], ["2026-05-27", "Eid ul-Adha"], ["2026-05-28", "Eid ul-Adha"], ["2026-06-25", "Ashura"], ["2026-06-26", "Ashura"],
    ["2026-08-14", "Independence Day"], ["2026-08-26", "Eid Milad un-Nabi"], ["2026-12-25", "Quaid-e-Azam Day"],
  ];
  for (const [date, name] of holidays) await prisma.holiday.upsert({ where: { date: ymd(date) }, update: {}, create: { date: ymd(date), name, isPaid: true } });

  console.log(`✔ Core data seeded. Admin login: ${adminEmail} / ${adminPassword} (you will be asked to change it).`);
  if (!demo) return;

  // ── Demo employees ───────────────────────────────────────────────────────
  const sales = await prisma.department.upsert({ where: { name: "Outbound Sales" }, update: {}, create: { name: "Outbound Sales" } });
  const support = await prisma.department.upsert({ where: { name: "Customer Support" }, update: {}, create: { name: "Customer Support" } });
  const ops = await prisma.department.upsert({ where: { name: "Operations" }, update: {}, create: { name: "Operations" } });

  const today = todayYmd();
  const demoEmployees = [
    { code: "NT-0002", first: "Ayesha", last: "Khan", email: "ayesha.khan@nexus-tel.com", dept: sales.id, title: "Senior SDR", salary: "90000", schedule: nightSchedule.id, joined: "2025-02-03" },
    { code: "NT-0003", first: "Bilal", last: "Ahmed", email: "bilal.ahmed@nexus-tel.com", dept: sales.id, title: "SDR", salary: "66000", schedule: nightSchedule.id, joined: "2025-06-16" },
    { code: "NT-0004", first: "Hira", last: "Malik", email: "hira.malik@nexus-tel.com", dept: support.id, title: "Support Specialist", salary: "60000", schedule: daySchedule.id, joined: "2025-04-01" },
    { code: "NT-0005", first: "Usman", last: "Tariq", email: "usman.tariq@nexus-tel.com", dept: ops.id, title: "QA Analyst", salary: "75000", schedule: daySchedule.id, joined: "2024-11-11" },
    { code: "NT-0006", first: "Sana", last: "Riaz", email: "sana.riaz@nexus-tel.com", dept: sales.id, title: "Appointment Setter", salary: "55000", schedule: nightSchedule.id, joined: "2026-01-12" },
    { code: "NT-0007", first: "Hamza", last: "Sheikh", email: "hamza.sheikh@nexus-tel.com", dept: support.id, title: "Team Lead", salary: "120000", schedule: daySchedule.id, joined: "2024-03-04" },
    { code: "NT-0008", first: "Zara", last: "Iqbal", email: "zara.iqbal@nexus-tel.com", dept: ops.id, title: "Campaign Coordinator", salary: "70000", schedule: daySchedule.id, joined: addDays(today, -12) },
  ];
  const demoHash = await hash("Employee!2026", { memoryCost: 65536, timeCost: 3, parallelism: 1 });
  const holidaySet = new Set(holidays.map((h) => h[0]));

  for (const d of demoEmployees) {
    const existing = await prisma.user.findUnique({ where: { email: d.email } });
    if (existing) continue;
    const user = await prisma.user.create({ data: { email: d.email, passwordHash: demoHash, role: "EMPLOYEE", mustChangePassword: false } });
    const emp = await prisma.employee.create({
      data: { userId: user.id, employeeCode: d.code, firstName: d.first, lastName: d.last, designation: d.title, departmentId: d.dept, employmentType: "FULL_TIME", joinedAt: ymd(d.joined), phone: `+92 3${Math.floor(rand() * 9)}${String(Math.floor(rand() * 1e8)).padStart(8, "0")}` },
    });
    await prisma.employeeSalary.create({
      data: {
        employeeId: emp.id, baseSalary: new Prisma.Decimal(d.salary), currency: "PKR", effectiveFrom: ymd(d.joined), reason: "Initial salary", createdById: admin.id,
        components: { create: [{ name: "Medical allowance", kind: "BONUS", amount: new Prisma.Decimal("5000"), isProrated: false }] },
      },
    });
    await prisma.employeeSchedule.create({ data: { employeeId: emp.id, scheduleId: d.schedule, effectiveFrom: ymd(d.joined), createdById: admin.id } });

    // Attendance history: last 75 days up to yesterday.
    const sched = d.schedule === nightSchedule.id ? nightSchedule : daySchedule;
    const from = addDays(today, -75) > d.joined ? addDays(today, -75) : d.joined;
    const rows: Prisma.AttendanceRecordCreateManyInput[] = [];
    for (let cur = from; cur < today; cur = addDays(cur, 1)) {
      let status: AttendanceStatus;
      let checkInAt: Date | null = null;
      let minutesLate: number | null = null;
      let source: "SELF" | "SYSTEM" = "SYSTEM";
      if (holidaySet.has(cur)) status = "HOLIDAY";
      else if (!sched.workingDays.includes(isoWeekday(cur))) status = "WEEKLY_OFF";
      else {
        const r = rand();
        const late = r < 0.12 ? 20 + Math.floor(rand() * 90) : r < 0.15 ? 250 + Math.floor(rand() * 120) : Math.floor(rand() * 14) - 10;
        if (r > 0.96) status = "ABSENT";
        else {
          status = late > 240 ? "HALF_DAY" : late > 15 ? "LATE" : "PRESENT";
          source = "SELF";
          const shiftStart = new Date(`${cur}T00:00:00+05:00`).getTime() + sched.shiftStartMin * 60_000;
          checkInAt = new Date(shiftStart + late * 60_000);
          minutesLate = Math.max(0, late);
        }
      }
      rows.push({ employeeId: emp.id, attendanceDate: ymd(cur), status, checkInAt, minutesLate, source, markedById: source === "SELF" ? user.id : null });
    }
    await prisma.attendanceRecord.createMany({ data: rows, skipDuplicates: true });
  }

  // A couple of leave requests for the queue.
  const ayesha = await prisma.employee.findUnique({ where: { employeeCode: "NT-0002" } });
  const casual = await prisma.leaveType.findUnique({ where: { code: "CASUAL" } });
  const annual = await prisma.leaveType.findUnique({ where: { code: "ANNUAL" } });
  if (ayesha && casual && annual && !(await prisma.leaveRequest.count({ where: { employeeId: ayesha.id } }))) {
    await prisma.leaveRequest.create({ data: { employeeId: ayesha.id, leaveTypeId: casual.id, startDate: ymd(addDays(today, 3)), endDate: ymd(addDays(today, 3)), workingDays: new Prisma.Decimal(1), reason: "Family commitment" } });
    await prisma.leaveRequest.create({ data: { employeeId: ayesha.id, leaveTypeId: annual.id, startDate: ymd(addDays(today, 20)), endDate: ymd(addDays(today, 24)), workingDays: new Prisma.Decimal(5), reason: "Annual vacation" } });
  }
  console.log("✔ Demo data seeded. Employee logins: <first>.<last>@nexus-tel.com / Employee!2026");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
