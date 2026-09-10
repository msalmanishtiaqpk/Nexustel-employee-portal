import type { Metadata } from "next";
import { requireEmployeePage } from "@/server/rbac";
import { myAttendance, myMonthSummary } from "@/server/services/attendance";
import { getSettings } from "@/server/services/settings";
import { currentYearMonth, formatTimeOfDay, formatYmd, monthRange, dbToYmd } from "@/lib/dates";
import { PageHeader } from "@/components/ui/page-header";
import { Card, EmptyState, StatCard } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { AttendanceBadge } from "@/components/ui/badge";
import { MonthPicker, parseYearMonth } from "@/components/employee/month-picker";

export const metadata: Metadata = { title: "My attendance" };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const actor = await requireEmployeePage();
  const settings = await getSettings();
  const cur = currentYearMonth(settings.timezone);
  const { year, month } = parseYearMonth(await searchParams, cur);
  const { start, end } = monthRange(year, month);
  const [summary, list] = await Promise.all([myMonthSummary(actor, year, month), myAttendance(actor, { from: start, to: end, pageSize: 31 })]);

  return (
    <>
      <PageHeader title="My attendance" description="Your complete attendance history. Only administrators can change a recorded day." actions={<MonthPicker year={year} month={month} basePath="/attendance" maxYear={cur.year} maxMonth={cur.month} />} />
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        <StatCard label="Present" value={summary.PRESENT} tone="good" />
        <StatCard label="Late" value={summary.LATE} tone="warn" />
        <StatCard label="Half day" value={summary.HALF_DAY} />
        <StatCard label="Absent" value={summary.ABSENT} tone="bad" />
        <StatCard label="Leave" value={summary.LEAVE} />
        <StatCard label="Holidays" value={summary.HOLIDAY} tone="gold" />
        <StatCard label="Weekly offs" value={summary.WEEKLY_OFF} />
      </div>
      <Card>
        {list.items.length === 0 ? (
          <EmptyState title="No attendance records for this month" description="Records appear once you mark attendance or the day is finalized." />
        ) : (
          <Table>
            <THead><tr><TH>Date</TH><TH>Status</TH><TH>Check-in</TH><TH>Late by</TH><TH>Note</TH></tr></THead>
            <TBody>
              {list.items.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium text-slate-900">{formatYmd(dbToYmd(r.attendanceDate), "EEE, dd MMM yyyy")}</TD>
                  <TD><AttendanceBadge status={r.status} /></TD>
                  <TD mono>{formatTimeOfDay(r.checkInAt, settings.timezone)}</TD>
                  <TD mono>{r.minutesLate ? `${r.minutesLate} min` : "—"}</TD>
                  <TD className="text-slate-500">{r.source === "ADMIN" ? `Corrected by admin${r.note ? `: ${r.note}` : ""}` : r.note ?? ""}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
