import Link from "next/link";
import { requireAdminPage } from "@/server/rbac";
import { prisma } from "@/server/db";
import { attendanceBoard } from "@/server/services/attendance";
import { getSettings } from "@/server/services/settings";
import { currentYearMonth, formatYmd, monthLabel, previousMonth, todayYmd } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import { AttendanceBadge, RunBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";

export default async function AdminDashboard() {
  const actor = await requireAdminPage();
  const settings = await getSettings();
  const today = todayYmd(settings.timezone);
  const cur = currentYearMonth(settings.timezone);
  const prev = previousMonth(cur.year, cur.month);
  const [board, pendingLeave, activeCount, lastRun, recentAudit] = await Promise.all([
    attendanceBoard(actor, today),
    prisma.leaveRequest.count({ where: { status: "PENDING" } }),
    prisma.employee.count({ where: { isActive: true } }),
    prisma.payrollRun.findUnique({ where: { periodYear_periodMonth: { periodYear: prev.year, periodMonth: prev.month } } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { actor: { select: { email: true } } } }),
  ]);
  const count = (s: string) => board.filter((r) => r.derived === s).length;
  const working = board.filter((r) => r.dayType === "WORKING");
  const notYet = count("PENDING");

  return (
    <>
      <PageHeader title="Overview" description={formatYmd(today, "EEEE, dd MMMM yyyy")} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatCard label="Active employees" value={activeCount} />
        <StatCard label="Scheduled today" value={working.length} />
        <StatCard label="Present" value={count("PRESENT") + count("LATE") + count("HALF_DAY")} tone="good" hint={`${count("LATE")} late · ${count("HALF_DAY")} half day`} />
        <StatCard label="Not yet marked" value={notYet} tone={notYet ? "warn" : "default"} />
        <StatCard label="Absent / leave" value={`${count("ABSENT")} / ${count("LEAVE")}`} tone={count("ABSENT") ? "bad" : "default"} />
        <StatCard label="Pending leave" value={pendingLeave} tone={pendingLeave ? "warn" : "default"} hint={<Link href="/admin/leave" className="text-brand-700 hover:underline">Review</Link>} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Today's attendance" actions={<Link href="/admin/attendance" className="text-sm text-brand-700 hover:underline">Open board</Link>} />
          <CardBody className="p-0">
            <ul className="divide-y divide-slate-100">
              {board.filter((r) => r.derived !== "WEEKLY_OFF" && r.derived !== "HOLIDAY").slice(0, 12).map((r) => (
                <li key={r.employee.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <div>
                    <Link href={`/admin/employees/${r.employee.id}`} className="font-medium text-slate-900 hover:text-brand-700">{r.employee.firstName} {r.employee.lastName}</Link>
                    <span className="ml-2 text-xs text-slate-500">{r.employee.employeeCode}{r.employee.department ? ` · ${r.employee.department}` : ""}</span>
                  </div>
                  <AttendanceBadge status={r.derived} />
                </li>
              ))}
              {board.length === 0 && <li className="px-5 py-6 text-sm text-slate-500">No active employees.</li>}
            </ul>
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Payroll" actions={<Link href="/admin/payroll" className="text-sm text-brand-700 hover:underline">Manage</Link>} />
            <CardBody>
              <p className="text-sm text-slate-600">{monthLabel(prev.year, prev.month)}</p>
              {lastRun ? (
                <div className="mt-1 flex items-center justify-between">
                  <RunBadge status={lastRun.status} />
                  <span className="font-display text-lg font-semibold">{formatMoney(lastRun.totalNet, settings.currency)}</span>
                </div>
              ) : (
                <Alert variant="warning" className="mt-2">Payroll for {monthLabel(prev.year, prev.month)} has not been run. <Link href="/admin/payroll" className="underline">Run it now</Link>.</Alert>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Recent activity" actions={<Link href="/admin/audit" className="text-sm text-brand-700 hover:underline">Audit log</Link>} />
            <CardBody className="p-0">
              <ul className="divide-y divide-slate-100 text-xs">
                {recentAudit.map((a) => (
                  <li key={a.id.toString()} className="px-5 py-2">
                    <span className="font-medium text-slate-800">{a.action.replace(/_/g, " ").toLowerCase()}</span> <span className="text-slate-500">{a.entityType}</span>
                    <p className="text-slate-500">{a.actor?.email ?? "system"} · {a.createdAt.toLocaleString("en-GB", { timeZone: settings.timezone })}</p>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
