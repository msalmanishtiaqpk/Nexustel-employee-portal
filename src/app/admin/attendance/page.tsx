import Link from "next/link";
import { requireAdminPage } from "@/server/rbac";
import { attendanceBoard } from "@/server/services/attendance";
import { listActiveEmployeesBrief } from "@/server/services/employees";
import { getSettings } from "@/server/services/settings";
import { addDays, formatTimeOfDay, formatYmd, isYmd, todayYmd } from "@/lib/dates";
import { PageHeader } from "@/components/ui/page-header";
import { Card, StatCard } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { AttendanceBadge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CorrectAttendanceButton } from "@/components/admin/correct-attendance";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default async function AttendanceBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdminPage();
  const sp = await searchParams;
  const settings = await getSettings();
  const today = todayYmd(settings.timezone);
  const date = isYmd(sp.date) && sp.date <= today ? sp.date : today;
  const [rows, employees] = await Promise.all([attendanceBoard(actor, date), listActiveEmployeesBrief(actor)]);
  const filter = sp.status ?? "";
  const visible = rows.filter((r) => !filter || r.derived === filter);
  const count = (s: string) => rows.filter((r) => r.derived === s).length;

  return (
    <>
      <PageHeader
        title={date === today ? "Today's attendance" : `Attendance · ${formatYmd(date, "EEE, dd MMM yyyy")}`}
        description="Live board for a single date. Use an employee's record for history by employee."
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/admin/attendance?date=${addDays(date, -1)}`} className="rounded-md border border-slate-300 bg-white p-2 hover:bg-slate-50" aria-label="Previous day"><ChevronLeft className="h-4 w-4" /></Link>
            <form method="get" className="flex items-center gap-2">
              <Input type="date" name="date" defaultValue={date} max={today} className="w-44" aria-label="Date" />
              <Select name="status" defaultValue={filter} className="w-40" aria-label="Filter status">
                <option value="">All statuses</option><option value="PENDING">Not yet marked</option><option value="PRESENT">Present</option><option value="LATE">Late</option><option value="HALF_DAY">Half day</option><option value="ABSENT">Absent</option><option value="LEAVE">Leave</option><option value="HOLIDAY">Holiday</option><option value="WEEKLY_OFF">Weekly off</option>
              </Select>
              <Button type="submit" variant="outline">Go</Button>
            </form>
            {date < today ? <Link href={`/admin/attendance?date=${addDays(date, 1)}`} className="rounded-md border border-slate-300 bg-white p-2 hover:bg-slate-50" aria-label="Next day"><ChevronRight className="h-4 w-4" /></Link> : <span className="p-2 text-slate-300"><ChevronRight className="h-4 w-4" /></span>}
          </div>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        <StatCard label="Present" value={count("PRESENT")} tone="good" />
        <StatCard label="Late" value={count("LATE")} tone="warn" />
        <StatCard label="Half day" value={count("HALF_DAY")} />
        <StatCard label="Absent" value={count("ABSENT")} tone="bad" />
        <StatCard label="Leave" value={count("LEAVE")} />
        <StatCard label="Not yet marked" value={count("PENDING")} />
        <StatCard label="Off / holiday" value={count("WEEKLY_OFF") + count("HOLIDAY")} />
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm text-slate-600">{visible.length} employee(s)</p>
          <form method="get" action="/admin/employees" className="flex items-center gap-2">
            <Select name="q" className="w-56" aria-label="Open employee record" defaultValue="">
              <option value="" disabled>View history by employee…</option>
              {employees.map((e) => <option key={e.id} value={e.employeeCode}>{e.employeeCode} · {e.firstName} {e.lastName}</option>)}
            </Select>
            <Button type="submit" variant="outline" size="sm">Open</Button>
          </form>
        </div>
        <Table>
          <THead><tr><TH>Employee</TH><TH>Department</TH><TH>Schedule</TH><TH>Window</TH><TH>Status</TH><TH>Check-in</TH><TH>Note</TH><TH right>Correct</TH></tr></THead>
          <TBody>
            {visible.map((r) => (
              <TR key={r.employee.id}>
                <TD><Link href={`/admin/employees/${r.employee.id}?tab=attendance`} className="font-medium text-slate-900 hover:text-brand-700">{r.employee.firstName} {r.employee.lastName}</Link><p className="text-xs text-slate-500">{r.employee.employeeCode}</p></TD>
                <TD>{r.employee.department ?? "—"}</TD>
                <TD className="text-xs">{r.schedule ?? <span className="text-rose-600">none</span>}</TD>
                <TD className="text-xs text-slate-500">{r.window && r.dayType === "WORKING" ? `${formatTimeOfDay(r.window.opensAt, settings.timezone)} – ${formatTimeOfDay(r.window.closesAt, settings.timezone)}` : "—"}</TD>
                <TD><AttendanceBadge status={r.derived} /></TD>
                <TD mono>{r.record?.checkInAt ? `${formatTimeOfDay(r.record.checkInAt, settings.timezone)}${r.record.minutesLate ? ` (+${r.record.minutesLate}m)` : ""}` : "—"}</TD>
                <TD className="max-w-[16rem] truncate text-xs text-slate-500" title={r.record?.note ?? ""}>{r.record?.source === "ADMIN" ? "Corrected · " : ""}{r.record?.note ?? ""}</TD>
                <TD right><CorrectAttendanceButton small employeeId={r.employee.id} employeeName={`${r.employee.firstName} ${r.employee.lastName}`} date={date} current={r.record?.status ?? null} locked={r.record?.isLocked} /></TD>
              </TR>
            ))}
            {visible.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">Nothing to show.</td></tr>}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
