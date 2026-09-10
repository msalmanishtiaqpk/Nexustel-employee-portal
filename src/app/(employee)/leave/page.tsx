import type { Metadata } from "next";
import { requireEmployeePage } from "@/server/rbac";
import { myBalances, myLeaveRequests } from "@/server/services/leave";
import { getSettings } from "@/server/services/settings";
import { currentYearMonth, dbToYmd, formatInstant, formatYmd, todayYmd } from "@/lib/dates";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { LeaveBadge } from "@/components/ui/badge";
import { ActionForm, Field } from "@/components/ui/form";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/button";
import { cancelLeaveAction, submitLeaveAction } from "@/server/actions/leave";

export const metadata: Metadata = { title: "Leave" };

export default async function LeavePage() {
  const actor = await requireEmployeePage();
  const settings = await getSettings();
  const { year } = currentYearMonth(settings.timezone);
  const today = todayYmd(settings.timezone);
  const [balances, requests] = await Promise.all([myBalances(actor, year), myLeaveRequests(actor)]);

  return (
    <>
      <PageHeader title="Leave" description={`Balances for ${year} and your requests.`} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {balances.map((b) => (
          <Card key={b.leaveType.id} className="px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{b.leaveType.name}</p>
            <p className="mt-2 font-display text-2xl font-semibold text-slate-900">{b.remaining === null ? "∞" : b.remaining.toString()}<span className="ml-1 text-sm font-normal text-slate-500">{b.allocated === null ? "unlimited" : `of ${b.allocated.toString()} left`}</span></p>
            <p className="mt-1 text-xs text-slate-500">{b.used.toString()} used · {b.pending.toString()} pending · {b.leaveType.isPaid ? "paid" : "unpaid"}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="New request" />
          <CardBody>
            <ActionForm action={submitLeaveAction} resetOnSuccess>
                  <Field label="Leave type" htmlFor="leaveTypeId" name="leaveTypeId">
                    <Select id="leaveTypeId" name="leaveTypeId" required defaultValue="">
                      <option value="" disabled>Select…</option>
                      {balances.map((b) => <option key={b.leaveType.id} value={b.leaveType.id}>{b.leaveType.name}{b.remaining !== null ? ` (${b.remaining.toString()} left)` : ""}</option>)}
                    </Select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="From" htmlFor="startDate" name="startDate"><Input id="startDate" name="startDate" type="date" required defaultValue={today} /></Field>
                    <Field label="To" htmlFor="endDate" name="endDate"><Input id="endDate" name="endDate" type="date" required defaultValue={today} /></Field>
                  </div>
                  <Checkbox name="isHalfDay" label="Half day (single day, where allowed)" />
                  <Field label="Reason" htmlFor="reason" name="reason"><Textarea id="reason" name="reason" required maxLength={500} /></Field>
                  <SubmitButton pendingText="Submitting…">Submit request</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="My requests" />
          {requests.length === 0 ? <div className="p-5"><EmptyState title="No leave requests yet" /></div> : (
            <Table>
              <THead><tr><TH>Type</TH><TH>Dates</TH><TH>Days</TH><TH>Status</TH><TH>Reviewed</TH><TH></TH></tr></THead>
              <TBody>
                {requests.map((r) => {
                  const cancellable = r.status === "PENDING" || (r.status === "APPROVED" && dbToYmd(r.startDate) > today);
                  return (
                    <TR key={r.id}>
                      <TD className="font-medium text-slate-900">{r.leaveType.name}</TD>
                      <TD>{formatYmd(r.startDate)}{r.startDate.getTime() !== r.endDate.getTime() ? ` – ${formatYmd(r.endDate)}` : ""}</TD>
                      <TD mono>{r.workingDays.toString()}</TD>
                      <TD><LeaveBadge status={r.status} />{r.reviewNote && <p className="mt-1 text-xs text-slate-500">{r.reviewNote}</p>}</TD>
                      <TD className="text-xs text-slate-500">{r.reviewedAt ? formatInstant(r.reviewedAt, settings.timezone) : "—"}</TD>
                      <TD right>
                        {cancellable && (
                          <ActionForm action={cancelLeaveAction} className="inline">
                            <input type="hidden" name="id" value={r.id} />
                            <SubmitButton variant="ghost" size="sm">Cancel</SubmitButton>
                          </ActionForm>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
