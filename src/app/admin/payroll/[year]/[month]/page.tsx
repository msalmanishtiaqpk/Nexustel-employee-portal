import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, RefreshCw } from "lucide-react";
import { requireAdminPage } from "@/server/rbac";
import { getRun, listAdjustments } from "@/server/services/payroll/run";
import { listActiveEmployeesBrief } from "@/server/services/employees";
import { getSettings } from "@/server/services/settings";
import { formatInstant, monthLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { addAdjustmentAction, deleteAdjustmentAction, finalizeRunAction, reopenRunAction, runPayrollAction } from "@/server/actions/payroll";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, EmptyState, StatCard } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge, RunBadge } from "@/components/ui/badge";
import { ActionForm, Field } from "@/components/ui/form";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export default async function PayrollRunPage({ params }: { params: Promise<{ year: string; month: string }> }) {
  const actor = await requireAdminPage();
  const p = await params;
  const year = Number(p.year), month = Number(p.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) notFound();
  const settings = await getSettings();
  const [run, adjustments, employees] = await Promise.all([getRun(actor, year, month), listAdjustments(actor, year, month), listActiveEmployeesBrief(actor)]);
  const label = monthLabel(year, month);
  const finalized = run?.status === "FINALIZED";
  const unapplied = adjustments.filter((a) => !a.payslipId);

  return (
    <>
      <PageHeader
        title={`Payroll · ${label}`}
        breadcrumbs={[{ label: "Payroll", href: "/admin/payroll" }, { label }]}
        description={run ? <span className="inline-flex items-center gap-2"><RunBadge status={run.status} /> Policy: {run.policy.name} · {run.status === "FINALIZED" ? `finalized ${formatInstant(run.finalizedAt, settings.timezone)}` : `computed ${formatInstant(run.runAt, settings.timezone)}`}</span> : "No run yet for this period."}
        actions={
          <>
            {run && <a href={`/api/admin/reports/payroll?year=${year}&month=${month}&format=xlsx`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50"><Download className="h-4 w-4" /> Register (XLSX)</a>}
            {!finalized && (
              <ActionForm action={runPayrollAction} quiet className="inline">
                <input type="hidden" name="year" value={year} /><input type="hidden" name="month" value={month} /><input type="hidden" name="allowCurrentMonth" value="true" />
                <SubmitButton variant="secondary" pendingText="Computing…"><RefreshCw className="h-4 w-4" /> {run ? "Re-run draft" : "Compute draft"}</SubmitButton>
              </ActionForm>
            )}
          </>
        }
      />

      {run?.notes && <Alert variant="warning" className="mb-4">{run.notes}</Alert>}
      {run?.status === "REOPENED" && <Alert variant="info" className="mb-4">This period was reopened{run.reopenReason ? ` (${run.reopenReason})` : ""}. Attendance is unlocked. Re-run the draft, then finalize again; previous payslips are kept for audit.</Alert>}

      {run && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Employees" value={run.employeeCount} />
          <StatCard label="Total gross" value={formatMoney(run.totalGross, settings.currency)} />
          <StatCard label="Total net" value={formatMoney(run.totalNet, settings.currency)} tone="brand" />
          <StatCard label="Unapplied adjustments" value={unapplied.length} tone={unapplied.length && run.status !== "DRAFT" ? "warn" : "default"} hint={unapplied.length ? "Re-run the draft to include them" : undefined} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Payslips" description={finalized ? "Final. Visible to employees." : "Draft — not visible to employees until finalized."} />
          {!run || run.payslips.length === 0 ? <div className="p-5"><EmptyState title="No payslips computed" description="Compute the draft to generate payslips for every employee employed during the month." /></div> : (
            <Table>
              <THead><tr><TH>Employee</TH><TH right>Working</TH><TH right>Payable</TH><TH right>Abs / Late / Half</TH><TH right>Gross</TH><TH right>Net</TH><TH></TH></tr></THead>
              <TBody>
                {run.payslips.map((ps) => (
                  <TR key={ps.id}>
                    <TD><Link href={`/admin/payslips/${ps.id}`} className="font-medium text-slate-900 hover:text-brand-700">{ps.employee.firstName} {ps.employee.lastName}</Link><p className="text-xs text-slate-500">{ps.employee.employeeCode}{ps.employee.department ? ` · ${ps.employee.department.name}` : ""}</p></TD>
                    <TD right mono>{ps.workingDays}</TD>
                    <TD right mono>{ps.payableDays.toString()}</TD>
                    <TD right mono className="text-xs">{ps.absentDays} / {ps.lateDays} / {ps.halfDays}</TD>
                    <TD right mono>{formatMoney(ps.grossPay, ps.currency)}</TD>
                    <TD right mono className="font-semibold">{formatMoney(ps.netPay, ps.currency)}</TD>
                    <TD right><a href={`/api/admin/payslips/${ps.id}/pdf`} className="text-xs text-brand-700 hover:underline">PDF</a></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <div className="space-y-6">
          {run && !finalized && run.payslips.length > 0 && (
            <Card>
              <CardHeader title="Finalize" />
              <CardBody>
                <ActionForm action={finalizeRunAction}>
                  <input type="hidden" name="runId" value={run.id} /><input type="hidden" name="year" value={year} /><input type="hidden" name="month" value={month} />
                  <p className="text-sm text-slate-600">Assigns payslip numbers, locks the month&apos;s attendance and publishes payslips to employees. Can be reopened later with a reason.</p>
                  <Checkbox name="confirm" label="I have reviewed the payslips" />
                  <SubmitButton className="w-full" variant="gold" pendingText="Finalizing…">Finalize {label}</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          )}
          {finalized && (
            <Card>
              <CardHeader title="Reopen" />
              <CardBody>
                <ActionForm action={reopenRunAction}>
                  <input type="hidden" name="runId" value={run.id} /><input type="hidden" name="year" value={year} /><input type="hidden" name="month" value={month} />
                  <Field label="Reason (audited)" name="reason"><Textarea name="reason" required placeholder="Late attendance correction for NT-0004" /></Field>
                  <SubmitButton className="w-full" variant="danger" pendingText="Reopening…">Reopen {label}</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Bonuses & deductions" description="One-off adjustments for this period." />
            <CardBody className="space-y-4">
              {!finalized && (
                <ActionForm action={addAdjustmentAction} resetOnSuccess>
                  <input type="hidden" name="year" value={year} /><input type="hidden" name="month" value={month} />
                  <Field label="Employee" name="employeeId"><Select name="employeeId" required defaultValue=""><option value="" disabled>Select…</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.employeeCode} · {e.firstName} {e.lastName}</option>)}</Select></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Type" name="kind"><Select name="kind" defaultValue="BONUS"><option value="BONUS">Bonus</option><option value="DEDUCTION">Deduction</option></Select></Field>
                    <Field label="Amount" name="amount"><Input name="amount" inputMode="decimal" required placeholder="10000" /></Field>
                  </div>
                  <Field label="Category" name="category"><Input name="category" required placeholder="Performance bonus / Advance recovery / Tax" /></Field>
                  <Field label="Description" name="description"><Input name="description" /></Field>
                  <SubmitButton size="sm" pendingText="Adding…">Add adjustment</SubmitButton>
                </ActionForm>
              )}
              {adjustments.length === 0 ? <p className="text-sm text-slate-500">No adjustments for this period.</p> : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {adjustments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                      <div>
                        <p className="font-medium text-slate-800">{a.employee.employeeCode} · {a.employee.firstName} {a.employee.lastName}</p>
                        <p className="text-xs text-slate-500">{a.kind === "BONUS" ? <Badge tone="green">Bonus</Badge> : <Badge tone="red">Deduction</Badge>} {a.category}{a.description ? ` — ${a.description}` : ""}{a.payslipId ? " · applied" : ""}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`tabular-nums font-medium ${a.kind === "DEDUCTION" ? "text-rose-700" : "text-emerald-700"}`}>{a.kind === "DEDUCTION" ? "−" : "+"}{formatMoney(a.amount, settings.currency)}</span>
                        {!a.payslipId && <ActionForm action={deleteAdjustmentAction} quiet className="inline"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="year" value={year} /><input type="hidden" name="month" value={month} /><SubmitButton variant="ghost" size="sm">Remove</SubmitButton></ActionForm>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
