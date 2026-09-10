import { requireAdminPage } from "@/server/rbac";
import { listHolidays, listOverrides, listSchedules } from "@/server/services/schedules";
import { getSettings } from "@/server/services/settings";
import { addDays, currentYearMonth, formatYmd, todayYmd } from "@/lib/dates";
import { createHolidayAction, createOverrideAction, deleteHolidayAction, deleteOverrideAction } from "@/server/actions/schedules";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionForm, Field } from "@/components/ui/form";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requireAdminPage();
  const settings = await getSettings();
  const today = todayYmd(settings.timezone);
  const cur = currentYearMonth(settings.timezone);
  const year = Number((await searchParams).year) || cur.year;
  const [holidays, overrides, schedules] = await Promise.all([listHolidays(year), listOverrides(addDays(today, -30), addDays(today, 90)), listSchedules(false)]);

  return (
    <>
      <PageHeader title="Holidays & attendance windows" description="Company holidays apply to every schedule. Window overrides change the check-in window for a single date." actions={<div className="flex gap-1 text-sm">{[year - 1, year, year + 1].map((y) => <Link key={y} href={`/admin/holidays?year=${y}`} className={`rounded-md px-3 py-1 ${y === year ? "bg-brand-600 text-white" : "border border-slate-300 bg-white hover:bg-slate-50"}`}>{y}</Link>)}</div>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader title={`Holidays ${year}`} description={`${holidays.length} day(s)`} />
            {holidays.length === 0 ? <div className="p-5"><EmptyState title="No holidays this year" /></div> : (
              <Table>
                <THead><tr><TH>Date</TH><TH>Name</TH><TH>Paid</TH><TH></TH></tr></THead>
                <TBody>
                  {holidays.map((h) => (
                    <TR key={h.id}>
                      <TD className="font-medium">{formatYmd(h.date, "EEE, dd MMM yyyy")}</TD>
                      <TD>{h.name}</TD>
                      <TD>{h.isPaid ? <Badge tone="green">Paid</Badge> : <Badge>Unpaid</Badge>}</TD>
                      <TD right><ActionForm action={deleteHolidayAction} quiet confirm={`Delete holiday “${h.name}”?`} className="inline"><input type="hidden" name="id" value={h.id} /><SubmitButton variant="ghost" size="sm">Delete</SubmitButton></ActionForm></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="Add holiday" />
            <CardBody>
              <ActionForm action={createHolidayAction} resetOnSuccess className="grid gap-4 sm:grid-cols-[1fr_2fr_auto_auto] sm:items-end">
                <Field label="Date" name="date"><Input name="date" type="date" required /></Field>
                <Field label="Name" name="name"><Input name="name" required placeholder="Eid ul-Fitr" /></Field>
                <Checkbox name="isPaid" label="Paid" defaultChecked className="pb-2.5" />
                <SubmitButton pendingText="Adding…">Add</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Window overrides" description="Next 90 days" />
            {overrides.length === 0 ? <div className="p-5"><EmptyState title="No overrides" description="Use an override to extend the window on a specific day (e.g. bad weather, office event)." /></div> : (
              <Table>
                <THead><tr><TH>Date</TH><TH>Schedule</TH><TH>Changes</TH><TH></TH></tr></THead>
                <TBody>
                  {overrides.map((o) => (
                    <TR key={o.id}>
                      <TD className="font-medium">{formatYmd(o.date)}</TD>
                      <TD>{o.schedule?.name ?? <Badge>All schedules</Badge>}</TD>
                      <TD className="text-xs text-slate-600">{[o.checkinOpensMinBefore != null && `opens −${o.checkinOpensMinBefore}m`, o.lateAfterMin != null && `late +${o.lateAfterMin}m`, o.halfDayAfterMin != null && `half day +${o.halfDayAfterMin}m`, o.checkinClosesAfterMin != null && `closes +${o.checkinClosesAfterMin}m`].filter(Boolean).join(" · ")}{o.reason && <p className="text-slate-400">{o.reason}</p>}</TD>
                      <TD right><ActionForm action={deleteOverrideAction} quiet className="inline"><input type="hidden" name="id" value={o.id} /><SubmitButton variant="ghost" size="sm">Delete</SubmitButton></ActionForm></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="Add window override" description="Leave a field blank to keep the schedule's value." />
            <CardBody>
              <ActionForm action={createOverrideAction} resetOnSuccess>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Date" name="date"><Input name="date" type="date" required defaultValue={today} /></Field>
                  <Field label="Schedule" name="scheduleId"><Select name="scheduleId" defaultValue=""><option value="">All schedules</option>{schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-4">
                  <Field label="Opens before (min)" name="checkinOpensMinBefore"><Input name="checkinOpensMinBefore" type="number" min={0} /></Field>
                  <Field label="Late after" name="lateAfterMin"><Input name="lateAfterMin" type="number" min={0} /></Field>
                  <Field label="Half day after" name="halfDayAfterMin"><Input name="halfDayAfterMin" type="number" min={0} /></Field>
                  <Field label="Closes after" name="checkinClosesAfterMin"><Input name="checkinClosesAfterMin" type="number" min={1} /></Field>
                </div>
                <Field label="Reason" name="reason"><Input name="reason" placeholder="Heavy rain — extended window" /></Field>
                <div className="flex justify-end"><SubmitButton pendingText="Saving…">Save override</SubmitButton></div>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
