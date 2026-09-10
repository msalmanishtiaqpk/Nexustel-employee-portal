import Link from "next/link";
import { requireEmployeePage } from "@/server/rbac";
import { myTodayState, myMonthSummary } from "@/server/services/attendance";
import { myProjectedSalary } from "@/server/services/payroll/run";
import { myLeaveRequests } from "@/server/services/leave";
import { getMyProfile } from "@/server/services/employees";
import { getSettings } from "@/server/services/settings";
import { currentYearMonth, formatInstant, formatTimeOfDay, formatYmd, monthLabel, todayYmd } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import { AttendanceBadge, LeaveBadge, ATTENDANCE_LABEL } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { AutoRefresh, MarkAttendanceButton } from "@/components/employee/mark-attendance";

export default async function EmployeeDashboard() {
  const actor = await requireEmployeePage();
  const settings = await getSettings();
  const tz = settings.timezone;
  const { year, month } = currentYearMonth(tz);
  const [profile, state, summary, salary, leaves] = await Promise.all([getMyProfile(actor), myTodayState(actor), myMonthSummary(actor, year, month), myProjectedSalary(actor), myLeaveRequests(actor)]);
  const pendingLeaves = leaves.filter((l) => l.status === "PENDING");
  const today = todayYmd(tz);

  return (
    <>
      <PageHeader title={`Good ${greeting(tz)}, ${profile.firstName}`} description={`${formatYmd(today, "EEEE, dd MMMM yyyy")} · ${profile.designation ?? "Employee"}${profile.department ? ` · ${profile.department.name}` : ""}`} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Today's attendance" description={state.kind === "OPEN" || state.kind === "MARKED" ? `Working day ${formatYmd(state.kind === "MARKED" ? state.record.attendanceDate : state.window.ymd)}` : "Attendance is only accepted inside your shift's check-in window."} />
          <CardBody>
            {state.kind === "INACTIVE" && <Alert variant="error">Your account is inactive. Contact HR.</Alert>}
            {state.kind === "NO_SCHEDULE" && <Alert variant="warning">No work schedule has been assigned to you yet. Please contact HR.</Alert>}
            {state.kind === "MARKED" && (
              <div className="flex flex-wrap items-center gap-4">
                <AttendanceBadge status={state.record.status} />
                <p className="text-sm text-slate-600">
                  {state.record.checkInAt ? <>Checked in at <strong>{formatTimeOfDay(state.record.checkInAt, tz)}</strong>{state.record.minutesLate ? ` (${state.record.minutesLate} min late)` : ""}</> : ATTENDANCE_LABEL[state.record.status]}
                </p>
              </div>
            )}
            {state.kind === "OPEN" && (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  Shift starts at <strong>{formatTimeOfDay(state.window.shiftStartAt, tz)}</strong>. Window closes at <strong>{formatTimeOfDay(state.window.closesAt, tz)}</strong>.
                  {state.wouldBe.status !== "PRESENT" && <> Checking in now will be recorded as <strong>{ATTENDANCE_LABEL[state.wouldBe.status]}</strong> ({state.wouldBe.minutesLate} min late).</>}
                </p>
                <MarkAttendanceButton label={state.wouldBe.status === "PRESENT" ? "Mark attendance" : `Mark attendance (${ATTENDANCE_LABEL[state.wouldBe.status]})`} />
                <AutoRefresh at={state.window.closesAt.toISOString()} />
              </div>
            )}
            {state.kind === "CLOSED" && (
              <div className="space-y-2 text-sm text-slate-600">
                <Alert variant={state.reason === "AFTER_CLOSE" ? "warning" : "info"}>
                  {state.reason === "NON_WORKING" && "Today is not a scheduled working day for you."}
                  {state.reason === "ON_LEAVE" && "You are on approved leave today."}
                  {state.reason === "BEFORE_OPEN" && state.lastWindow && <>The check-in window opens at <strong>{formatInstant(state.lastWindow.opensAt, tz, "hh:mm a")}</strong>.</>}
                  {state.reason === "AFTER_CLOSE" && "Today's check-in window has closed. If you were present, ask an administrator to correct your attendance."}
                </Alert>
                {state.next && <p>Next check-in window: <strong>{formatInstant(state.next.opensAt, tz, "EEE dd MMM, hh:mm a")}</strong> – {formatTimeOfDay(state.next.closesAt, tz)}</p>}
                <AutoRefresh at={state.next?.opensAt.toISOString() ?? null} />
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={salary.kind === "FINAL" ? "This month's salary" : "Projected salary"} description={monthLabel(year, month)} />
          <CardBody>
            {salary.kind === "FINAL" && (
              <>
                <p className="font-display text-3xl font-semibold text-brand-700">{formatMoney(salary.payslip.netPay, salary.payslip.currency)}</p>
                <p className="mt-1 text-xs text-slate-500">Final · <Link href={`/salary/${salary.payslip.id}`} className="text-brand-700 hover:underline">View payslip</Link></p>
              </>
            )}
            {salary.kind === "PROJECTED" && (
              <>
                <p className="font-display text-3xl font-semibold text-slate-900">{formatMoney(salary.result.netPay, salary.rules.currency)}</p>
                <p className="mt-1 text-xs text-slate-500">Estimate based on attendance through {formatYmd(salary.through)}; remaining days assumed present. Final figure depends on the payroll run.</p>
                <Link href="/salary" className="mt-3 inline-block text-sm text-brand-700 hover:underline">See breakdown →</Link>
              </>
            )}
            {(salary.kind === "NO_POLICY" || salary.kind === "NO_SALARY") && <p className="text-sm text-slate-500">Salary information is not available yet.</p>}
          </CardBody>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 font-display text-lg font-semibold text-slate-900">{monthLabel(year, month)} summary</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Present" value={summary.PRESENT} tone="good" />
        <StatCard label="Late" value={summary.LATE} tone="warn" />
        <StatCard label="Half day" value={summary.HALF_DAY} />
        <StatCard label="Absent" value={summary.ABSENT} tone="bad" />
        <StatCard label="Leave" value={summary.LEAVE} />
        <StatCard label="Scheduled days" value={summary.scheduledDays} hint={`${summary.HOLIDAY} holiday · ${summary.WEEKLY_OFF} off`} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Leave requests" actions={<Link href="/leave" className="text-sm text-brand-700 hover:underline">Manage</Link>} />
          <CardBody>
            {leaves.length === 0 ? <p className="text-sm text-slate-500">No leave requests yet.</p> : (
              <ul className="divide-y divide-slate-100">
                {leaves.slice(0, 4).map((l) => (
                  <li key={l.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <p className="font-medium text-slate-800">{l.leaveType.name}</p>
                      <p className="text-xs text-slate-500">{formatYmd(l.startDate)}{l.startDate.getTime() !== l.endDate.getTime() ? ` – ${formatYmd(l.endDate)}` : ""} · {l.workingDays.toString()} day(s)</p>
                    </div>
                    <LeaveBadge status={l.status} />
                  </li>
                ))}
              </ul>
            )}
            {pendingLeaves.length > 0 && <p className="mt-2 text-xs text-slate-500">{pendingLeaves.length} awaiting approval</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Employment" actions={<Link href="/profile" className="text-sm text-brand-700 hover:underline">Full profile</Link>} />
          <CardBody>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs uppercase tracking-wide text-slate-500">Employee code</dt><dd className="font-medium">{profile.employeeCode}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-slate-500">Joined</dt><dd className="font-medium">{formatYmd(profile.joinedAt)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-slate-500">Schedule</dt><dd className="font-medium">{profile.schedules[0]?.schedule.name ?? "Company default"}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-slate-500">Manager</dt><dd className="font-medium">{profile.manager ? `${profile.manager.firstName} ${profile.manager.lastName}` : "—"}</dd></div>
            </dl>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function greeting(tz: string) {
  const h = Number(new Intl.DateTimeFormat("en", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date()));
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}
