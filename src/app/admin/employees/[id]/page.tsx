import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/server/rbac";
import { getEmployee, listActiveEmployeesBrief, listDepartments } from "@/server/services/employees";
import { listSchedules } from "@/server/services/schedules";
import { adminListAttendance, monthSummaryFor } from "@/server/services/attendance";
import { balancesFor, listLeaveRequests, listLeaveTypes } from "@/server/services/leave";
import { payslipHistoryFor } from "@/server/services/payroll/run";
import { getSettings } from "@/server/services/settings";
import { prisma } from "@/server/db";
import { NotFoundError } from "@/server/errors";
import { currentYearMonth, dbToYmd, formatInstant, formatTimeOfDay, formatYmd, minutesToLabel, monthLabel, monthRange, todayYmd } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PageHeader, DescriptionList } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, EmptyState, StatCard } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActiveBadge, AttendanceBadge, Badge, LeaveBadge, RunBadge } from "@/components/ui/badge";
import { ActionForm } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/button";
import { updateEmployeeAction } from "@/server/actions/employees";
import { EmployeeFormFields } from "@/components/admin/employee-form";
import { AdjustBalanceDialog, AssignScheduleDialog, ResetPasswordDialog, SetSalaryDialog, ToggleActiveDialog } from "@/components/admin/employee-dialogs";
import { CorrectAttendanceButton } from "@/components/admin/correct-attendance";
import { MonthPicker, parseYearMonth } from "@/components/employee/month-picker";

const TABS = [["overview", "Overview"], ["edit", "Edit profile"], ["salary", "Salary"], ["schedule", "Schedule"], ["attendance", "Attendance"], ["leave", "Leave"], ["payslips", "Payslips"]] as const;
type Tab = (typeof TABS)[number][0];
const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function EmployeeDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdminPage();
  const { id } = await params;
  const sp = await searchParams;
  const tab = (TABS.some(([t]) => t === sp.tab) ? sp.tab : "overview") as Tab;
  const e = await getEmployee(actor, id).catch((err) => { if (err instanceof NotFoundError) notFound(); throw err; });
  const settings = await getSettings();
  const today = todayYmd(settings.timezone);
  const cur = currentYearMonth(settings.timezone);
  const currentSalary = e.salaries.find((s) => !s.effectiveTo) ?? e.salaries[0];
  const currentSchedule = e.schedules.find((s) => !s.effectiveTo) ?? e.schedules[0];
  const href = (t: Tab) => `/admin/employees/${e.id}?tab=${t}`;

  return (
    <>
      <PageHeader
        title={`${e.firstName} ${e.lastName}`}
        breadcrumbs={[{ label: "Employees", href: "/admin/employees" }, { label: e.employeeCode }]}
        description={<span className="inline-flex flex-wrap items-center gap-2">{e.employeeCode} · {e.designation ?? "—"}{e.department ? ` · ${e.department.name}` : ""} <ActiveBadge active={e.isActive} /> {e.user.role === "ADMIN" && <Badge tone="gold">Admin</Badge>}</span>}
        actions={<><ResetPasswordDialog employeeId={e.id} /><ToggleActiveDialog employeeId={e.id} isActive={e.isActive} /></>}
      />
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Sections">
        {TABS.map(([t, label]) => (
          <Link key={t} href={href(t)} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>{label}</Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Profile" />
            <CardBody>
              <DescriptionList cols={3} items={[
                { label: "Work email", value: e.user.email }, { label: "Phone", value: e.phone }, { label: "Personal email", value: e.personalEmail },
                { label: "Employment type", value: e.employmentType.replace("_", " ").toLowerCase() }, { label: "Joined", value: formatYmd(e.joinedAt) }, { label: "Terminated", value: e.terminatedAt ? formatYmd(e.terminatedAt) : "—" },
                { label: "Reports to", value: e.manager ? <Link href={`/admin/employees/${e.manager.id}`} className="text-brand-700 hover:underline">{e.manager.firstName} {e.manager.lastName}</Link> : "—" }, { label: "Date of birth", value: e.dateOfBirth ? formatYmd(e.dateOfBirth) : "—" }, { label: "Gender", value: e.gender },
                { label: "National ID", value: e.nationalId }, { label: "Bank", value: [e.bankName, e.bankAccountTitle, e.bankAccount].filter(Boolean).join(" · ") || "—" }, { label: "Emergency contact", value: e.emergencyContactName ? `${e.emergencyContactName} · ${e.emergencyContactPhone ?? ""}` : "—" },
                { label: "Address", value: e.address }, { label: "Last login", value: e.user.lastLoginAt ? formatInstant(e.user.lastLoginAt, settings.timezone) : "Never" }, { label: "Notes", value: e.notes },
              ]} />
            </CardBody>
          </Card>
          <div className="space-y-4">
            <StatCard label="Current base salary" value={currentSalary ? formatMoney(currentSalary.baseSalary, currentSalary.currency) : "—"} hint={currentSalary ? `since ${formatYmd(currentSalary.effectiveFrom)}` : "No salary record"} tone="brand" />
            <StatCard label="Schedule" value={currentSchedule?.schedule.name ?? "Company default"} hint={currentSchedule ? `${minutesToLabel(currentSchedule.schedule.shiftStartMin)} – ${minutesToLabel(currentSchedule.schedule.shiftEndMin)}` : undefined} />
            <OverviewMonth employeeId={e.id} year={cur.year} month={cur.month} tz={settings.timezone} />
          </div>
        </div>
      )}

      {tab === "edit" && <EditTab employee={e} />}

      {tab === "salary" && (
        <Card>
          <CardHeader title="Salary history" description="Effective-dated. Payroll uses the record in effect at the end of each month." actions={<SetSalaryDialog employeeId={e.id} today={today} current={currentSalary ? { baseSalary: currentSalary.baseSalary.toString(), components: currentSalary.components.map((c) => ({ name: c.name, kind: c.kind, amount: c.amount.toString(), isProrated: c.isProrated })) } : null} />} />
          {e.salaries.length === 0 ? <div className="p-5"><EmptyState title="No salary record" /></div> : (
            <Table>
              <THead><tr><TH>Effective from</TH><TH>Effective to</TH><TH right>Base salary</TH><TH>Components</TH><TH>Reason</TH></tr></THead>
              <TBody>
                {e.salaries.map((s) => (
                  <TR key={s.id}>
                    <TD>{formatYmd(s.effectiveFrom)}</TD>
                    <TD>{s.effectiveTo ? formatYmd(s.effectiveTo) : <Badge tone="green">Current</Badge>}</TD>
                    <TD right mono className="font-semibold">{formatMoney(s.baseSalary, s.currency)}</TD>
                    <TD className="text-xs">{s.components.length ? s.components.map((c) => `${c.kind === "DEDUCTION" ? "−" : "+"}${c.name} ${formatMoney(c.amount, s.currency)}${c.isProrated ? " (pro-rated)" : ""}`).join(", ") : "—"}</TD>
                    <TD className="text-slate-500">{s.reason ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {tab === "schedule" && <ScheduleTab employee={e} today={today} />}
      {tab === "attendance" && <AttendanceTab employee={e} sp={sp} tz={settings.timezone} cur={cur} />}
      {tab === "leave" && <LeaveTab employee={e} year={cur.year} />}
      {tab === "payslips" && <PayslipsTab employeeId={e.id} />}
    </>
  );
}

async function OverviewMonth({ employeeId, year, month, tz }: { employeeId: string; year: number; month: number; tz: string }) {
  const s = await monthSummaryFor(prisma, employeeId, year, month, tz);
  return (
    <Card className="px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{monthLabel(year, month)}</p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
        <div><p className="font-display text-xl font-semibold text-emerald-700">{s.PRESENT}</p><p className="text-xs text-slate-500">present</p></div>
        <div><p className="font-display text-xl font-semibold text-amber-700">{s.LATE}</p><p className="text-xs text-slate-500">late</p></div>
        <div><p className="font-display text-xl font-semibold text-rose-700">{s.ABSENT}</p><p className="text-xs text-slate-500">absent</p></div>
      </div>
    </Card>
  );
}

async function EditTab({ employee: e }: { employee: Awaited<ReturnType<typeof getEmployee>> }) {
  const actor = await requireAdminPage();
  const [departments, managers] = await Promise.all([listDepartments(), listActiveEmployeesBrief(actor)]);
  return (
    <Card>
      <CardBody>
        <ActionForm action={updateEmployeeAction}>
          <input type="hidden" name="employeeId" value={e.id} />
          <EmployeeFormFields mode="edit" employee={e} departments={departments} managers={managers} />
          <div className="flex justify-end"><SubmitButton pendingText="Saving…">Save changes</SubmitButton></div>
        </ActionForm>
      </CardBody>
    </Card>
  );
}

async function ScheduleTab({ employee: e, today }: { employee: Awaited<ReturnType<typeof getEmployee>>; today: string }) {
  const schedules = await listSchedules(false);
  const current = e.schedules.find((s) => !s.effectiveTo);
  return (
    <Card>
      <CardHeader title="Work schedule" description="Determines working days, shift times and the attendance window." actions={<AssignScheduleDialog employeeId={e.id} today={today} schedules={schedules} currentId={current?.scheduleId} />} />
      {e.schedules.length === 0 ? <div className="p-5"><EmptyState title="No explicit assignment" description="The company default schedule applies." /></div> : (
        <Table>
          <THead><tr><TH>Effective from</TH><TH>Effective to</TH><TH>Schedule</TH><TH>Shift</TH><TH>Working days</TH><TH>Window</TH></tr></THead>
          <TBody>
            {e.schedules.map((s) => (
              <TR key={s.id}>
                <TD>{formatYmd(s.effectiveFrom)}</TD>
                <TD>{s.effectiveTo ? formatYmd(s.effectiveTo) : <Badge tone="green">Current</Badge>}</TD>
                <TD className="font-medium">{s.schedule.name}</TD>
                <TD>{minutesToLabel(s.schedule.shiftStartMin)} – {minutesToLabel(s.schedule.shiftEndMin)}{s.schedule.shiftEndMin <= s.schedule.shiftStartMin ? " (+1)" : ""}</TD>
                <TD>{s.schedule.workingDays.map((d) => DAYS[d]).join(", ")}</TD>
                <TD className="text-xs text-slate-500">opens −{s.schedule.checkinOpensMinBefore}m · late +{s.schedule.lateAfterMin}m · half day +{s.schedule.halfDayAfterMin}m · closes +{s.schedule.checkinClosesAfterMin}m</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

async function AttendanceTab({ employee: e, sp, tz, cur }: { employee: Awaited<ReturnType<typeof getEmployee>>; sp: Record<string, string | undefined>; tz: string; cur: { year: number; month: number } }) {
  const actor = await requireAdminPage();
  const { year, month } = parseYearMonth(sp, cur);
  const { start, end } = monthRange(year, month);
  const [summary, list] = await Promise.all([monthSummaryFor(prisma, e.id, year, month, tz), adminListAttendance(actor, e.id, { from: start, to: end, pageSize: 31 })]);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <MonthPicker year={year} month={month} basePath={`/admin/employees/${e.id}?tab=attendance&`} maxYear={cur.year} maxMonth={cur.month} />
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge tone="green">Present {summary.PRESENT}</Badge><Badge tone="amber">Late {summary.LATE}</Badge><Badge tone="sky">Half {summary.HALF_DAY}</Badge><Badge tone="red">Absent {summary.ABSENT}</Badge><Badge tone="violet">Leave {summary.LEAVE}</Badge><Badge tone="gold">Holiday {summary.HOLIDAY}</Badge><Badge>Off {summary.WEEKLY_OFF}</Badge>
        </div>
      </div>
      <Card>
        <Table>
          <THead><tr><TH>Date</TH><TH>Status</TH><TH>Check-in</TH><TH>Late by</TH><TH>Source</TH><TH>Note</TH><TH right>Correct</TH></tr></THead>
          <TBody>
            {list.items.map((r) => {
              const d = dbToYmd(r.attendanceDate);
              return (
                <TR key={r.id}>
                  <TD className="font-medium text-slate-900">{formatYmd(d, "EEE, dd MMM")}</TD>
                  <TD><AttendanceBadge status={r.status} /></TD>
                  <TD mono>{formatTimeOfDay(r.checkInAt, tz)}</TD>
                  <TD mono>{r.minutesLate ? `${r.minutesLate}m` : "—"}</TD>
                  <TD className="text-xs text-slate-500">{r.source.toLowerCase().replace("_", " ")}</TD>
                  <TD className="text-xs text-slate-500">{r.note ?? ""}</TD>
                  <TD right><CorrectAttendanceButton small employeeId={e.id} employeeName={`${e.firstName} ${e.lastName}`} date={d} current={r.status} locked={r.isLocked} /></TD>
                </TR>
              );
            })}
            {list.items.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">No records for this month.</td></tr>}
          </TBody>
        </Table>
      </Card>
    </>
  );
}

async function LeaveTab({ employee: e, year }: { employee: Awaited<ReturnType<typeof getEmployee>>; year: number }) {
  const actor = await requireAdminPage();
  const [balances, requests, types] = await Promise.all([balancesFor(prisma, e.id, year), listLeaveRequests(actor, { employeeId: e.id, pageSize: 50 }), listLeaveTypes(false)]);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={`Leave balances · ${year}`} actions={<AdjustBalanceDialog employeeId={e.id} year={year} types={types.map((t) => ({ id: t.id, name: t.name }))} />} />
        <Table>
          <THead><tr><TH>Type</TH><TH right>Allocated</TH><TH right>Used</TH><TH right>Pending</TH><TH right>Remaining</TH></tr></THead>
          <TBody>{balances.map((b) => <TR key={b.leaveType.id}><TD className="font-medium">{b.leaveType.name} <span className="text-xs text-slate-500">{b.leaveType.isPaid ? "paid" : "unpaid"}</span></TD><TD right mono>{b.allocated?.toString() ?? "∞"}</TD><TD right mono>{b.used.toString()}</TD><TD right mono>{b.pending.toString()}</TD><TD right mono className="font-semibold">{b.remaining?.toString() ?? "∞"}</TD></TR>)}</TBody>
        </Table>
      </Card>
      <Card>
        <CardHeader title="Leave requests" />
        {requests.items.length === 0 ? <div className="p-5"><EmptyState title="No leave requests" /></div> : (
          <Table>
            <THead><tr><TH>Type</TH><TH>Dates</TH><TH right>Days</TH><TH>Status</TH><TH>Reason</TH><TH>Review</TH></tr></THead>
            <TBody>{requests.items.map((r) => <TR key={r.id}><TD className="font-medium">{r.leaveType.name}</TD><TD>{formatYmd(r.startDate)} – {formatYmd(r.endDate)}</TD><TD right mono>{r.workingDays.toString()}</TD><TD><LeaveBadge status={r.status} /></TD><TD className="text-xs text-slate-500">{r.reason}</TD><TD className="text-xs text-slate-500">{r.reviewNote ?? ""}{r.status === "PENDING" && <Link href="/admin/leave" className="text-brand-700 hover:underline">Review in queue</Link>}</TD></TR>)}</TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

async function PayslipsTab({ employeeId }: { employeeId: string }) {
  const actor = await requireAdminPage();
  const payslips = await payslipHistoryFor(actor, employeeId);
  return (
    <Card>
      <CardHeader title="Payslips" />
      {payslips.length === 0 ? <div className="p-5"><EmptyState title="No payslips" description="Payslips are produced by payroll runs." /></div> : (
        <Table>
          <THead><tr><TH>Period</TH><TH>Payslip no.</TH><TH>Run status</TH><TH right>Gross</TH><TH right>Net</TH><TH></TH></tr></THead>
          <TBody>{payslips.map((p) => <TR key={p.id}><TD className="font-medium"><Link href={`/admin/payslips/${p.id}`} className="hover:text-brand-700">{monthLabel(p.run.periodYear, p.run.periodMonth)}</Link></TD><TD mono>{p.payslipNumber ?? "—"}</TD><TD><RunBadge status={p.run.status} /></TD><TD right mono>{formatMoney(p.grossPay, p.currency)}</TD><TD right mono className="font-semibold">{formatMoney(p.netPay, p.currency)}</TD><TD right><a href={`/api/admin/payslips/${p.id}/pdf`} className="text-sm text-brand-700 hover:underline">PDF</a></TD></TR>)}</TBody>
        </Table>
      )}
    </Card>
  );
}
