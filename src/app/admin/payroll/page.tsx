import Link from "next/link";
import { requireAdminPage } from "@/server/rbac";
import { listPolicies, listRuns } from "@/server/services/payroll/run";
import { getSettings } from "@/server/services/settings";
import { currentYearMonth, formatInstant, monthLabel, previousMonth } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { runPayrollAction } from "@/server/actions/payroll";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { RunBadge } from "@/components/ui/badge";
import { ActionForm, Field } from "@/components/ui/form";
import { Checkbox, Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export default async function PayrollPage() {
  const actor = await requireAdminPage();
  const settings = await getSettings();
  const cur = currentYearMonth(settings.timezone);
  const prev = previousMonth(cur.year, cur.month);
  const [runs, policies] = await Promise.all([listRuns(actor), listPolicies()]);
  const years = [cur.year - 1, cur.year];

  return (
    <>
      <PageHeader title="Payroll" description="Run a draft, review every payslip, then finalize. Finalized months lock attendance." actions={<Link href="/admin/payroll/policy" className="text-sm text-brand-700 hover:underline">Payroll policy →</Link>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Run payroll" />
          <CardBody>
            {policies.length === 0 ? <Alert variant="warning">No payroll policy exists yet. <Link href="/admin/payroll/policy" className="underline">Create one</Link> first.</Alert> : (
              <ActionForm action={runPayrollAction} redirectTo="/admin/payroll/{year}/{month}">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Month" name="month"><Select name="month" defaultValue={String(prev.month)}>{Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{monthLabel(2000, m).split(" ")[0]}</option>)}</Select></Field>
                  <Field label="Year" name="year"><Select name="year" defaultValue={String(prev.year)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select></Field>
                </div>
                <Checkbox name="allowCurrentMonth" label="Allow partial (current) month preview" />
                <p className="text-xs text-slate-500">Re-running a draft replaces its payslips. Finalized months must be reopened first.</p>
                <SubmitButton className="w-full" pendingText="Computing…">Compute draft</SubmitButton>
              </ActionForm>
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Payroll runs" />
          {runs.length === 0 ? <div className="p-5"><EmptyState title="No payroll runs yet" /></div> : (
            <Table>
              <THead><tr><TH>Period</TH><TH>Status</TH><TH right>Employees</TH><TH right>Total net</TH><TH>Policy</TH><TH>Last run</TH></tr></THead>
              <TBody>
                {runs.map((r) => (
                  <TR key={r.id}>
                    <TD><Link href={`/admin/payroll/${r.periodYear}/${r.periodMonth}`} className="font-medium text-slate-900 hover:text-brand-700">{monthLabel(r.periodYear, r.periodMonth)}</Link></TD>
                    <TD><RunBadge status={r.status} /></TD>
                    <TD right mono>{r.employeeCount}</TD>
                    <TD right mono className="font-semibold">{formatMoney(r.totalNet, settings.currency)}</TD>
                    <TD className="text-xs text-slate-500">{r.policy.name}</TD>
                    <TD className="text-xs text-slate-500">{formatInstant(r.finalizedAt ?? r.runAt, settings.timezone)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
