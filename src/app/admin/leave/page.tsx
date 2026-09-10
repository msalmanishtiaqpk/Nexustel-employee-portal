import Link from "next/link";
import { requireAdminPage } from "@/server/rbac";
import { listLeaveRequests } from "@/server/services/leave";
import { getSettings } from "@/server/services/settings";
import { formatInstant, formatYmd } from "@/lib/dates";
import { PageHeader } from "@/components/ui/page-header";
import { Card, EmptyState } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, Pagination } from "@/components/ui/table";
import { LeaveBadge } from "@/components/ui/badge";
import { ReviewLeaveButtons } from "@/components/admin/employee-dialogs";
import { cn } from "@/lib/utils";
import type { LeaveStatus } from "@prisma/client";

const FILTERS: [LeaveStatus | "ALL", string][] = [["PENDING", "Pending"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"], ["CANCELLED", "Cancelled"], ["ALL", "All"]];

export default async function LeaveQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdminPage();
  const sp = await searchParams;
  const status = (FILTERS.some(([f]) => f === sp.status) ? sp.status : "PENDING") as LeaveStatus | "ALL";
  const page = Number(sp.page) || 1;
  const settings = await getSettings();
  const list = await listLeaveRequests(actor, { status: status === "ALL" ? undefined : status, page });

  return (
    <>
      <PageHeader title="Leave requests" description="Approving writes Leave attendance for the covered working days." actions={<Link href="/admin/leave/types" className="text-sm text-brand-700 hover:underline">Leave types →</Link>} />
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {FILTERS.map(([f, l]) => <Link key={f} href={`/admin/leave?status=${f}`} className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", status === f ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>{l}</Link>)}
      </div>
      <Card>
        {list.items.length === 0 ? <div className="p-5"><EmptyState title={status === "PENDING" ? "No pending requests" : "No requests"} /></div> : (
          <Table>
            <THead><tr><TH>Employee</TH><TH>Type</TH><TH>Dates</TH><TH right>Days</TH><TH>Reason</TH><TH>Status</TH><TH>Submitted</TH><TH></TH></tr></THead>
            <TBody>
              {list.items.map((r) => (
                <TR key={r.id}>
                  <TD><Link href={`/admin/employees/${r.employee.id}?tab=leave`} className="font-medium text-slate-900 hover:text-brand-700">{r.employee.firstName} {r.employee.lastName}</Link><p className="text-xs text-slate-500">{r.employee.employeeCode}{r.employee.department ? ` · ${r.employee.department.name}` : ""}</p></TD>
                  <TD>{r.leaveType.name}<p className="text-xs text-slate-500">{r.leaveType.isPaid ? "paid" : "unpaid"}</p></TD>
                  <TD>{formatYmd(r.startDate)}{r.startDate.getTime() !== r.endDate.getTime() ? ` – ${formatYmd(r.endDate)}` : ""}{r.isHalfDay ? " (half)" : ""}</TD>
                  <TD right mono>{r.workingDays.toString()}</TD>
                  <TD className="max-w-[16rem] text-xs text-slate-600">{r.reason}</TD>
                  <TD><LeaveBadge status={r.status} />{r.reviewNote && <p className="mt-1 text-xs text-slate-500">{r.reviewNote}</p>}</TD>
                  <TD className="text-xs text-slate-500">{formatInstant(r.createdAt, settings.timezone)}</TD>
                  <TD right>{r.status === "PENDING" && <ReviewLeaveButtons id={r.id} />}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} hrefFor={(p) => `/admin/leave?status=${status}&page=${p}`} />
      </Card>
    </>
  );
}
