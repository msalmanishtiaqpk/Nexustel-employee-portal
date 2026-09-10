import { requireAdminPage } from "@/server/rbac";
import { listPolicies } from "@/server/services/payroll/run";
import { getSettings } from "@/server/services/settings";
import { formatYmd, todayYmd } from "@/lib/dates";
import { createPolicyAction } from "@/server/actions/payroll";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionForm, Field } from "@/components/ui/form";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

export default async function PolicyPage() {
  await requireAdminPage();
  const settings = await getSettings();
  const policies = await listPolicies();
  const cur = policies[0];
  const today = todayYmd(settings.timezone);
  const firstOfNextMonth = (() => { const [y, m] = today.split("-").map(Number); const ny = m === 12 ? y + 1 : y; const nm = m === 12 ? 1 : m + 1; return `${ny}-${String(nm).padStart(2, "0")}-01`; })();

  return (
    <>
      <PageHeader title="Payroll policy" breadcrumbs={[{ label: "Payroll", href: "/admin/payroll" }, { label: "Policy" }]} description="Every rule the salary engine uses. Policies are versioned by effective date; a month uses the policy in effect on its first day." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="New policy version" description={cur ? `Pre-filled from “${cur.name}”.` : "No policy yet — create the first one."} />
          <CardBody>
            <ActionForm action={createPolicyAction}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" name="name"><Input name="name" required defaultValue={cur?.name ?? "Standard policy"} /></Field>
                <Field label="Effective from" name="effectiveFrom" hint="Use the 1st of a month. Cannot predate a finalized run."><Input name="effectiveFrom" type="date" required defaultValue={firstOfNextMonth} /></Field>
              </div>
              <fieldset className="rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-sm font-semibold text-slate-700">Per-day rate</legend>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Salary basis" name="salaryBasis">
                    <Select name="salaryBasis" defaultValue={cur?.salaryBasis ?? "WORKING_DAYS"}>
                      <option value="WORKING_DAYS">Working days in month</option>
                      <option value="CALENDAR_DAYS">Calendar days in month</option>
                      <option value="FIXED_DIVISOR">Fixed divisor</option>
                    </Select>
                  </Field>
                  <Field label="Fixed divisor" name="fixedDivisor" hint="Only for fixed-divisor basis, e.g. 30 or 26"><Input name="fixedDivisor" type="number" min={1} defaultValue={cur?.fixedDivisor ?? ""} /></Field>
                  <Field label="Currency" name="currency"><Input name="currency" maxLength={3} defaultValue={cur?.currency ?? settings.currency} /></Field>
                </div>
                <div className="mt-3 flex flex-wrap gap-4">
                  <Checkbox name="countHolidaysAsPaid" label="Holidays are paid" defaultChecked={cur?.countHolidaysAsPaid ?? true} />
                  <Checkbox name="countWeeklyOffAsPaid" label="Weekly offs are paid (calendar-days basis)" defaultChecked={cur?.countWeeklyOffAsPaid ?? true} />
                  <Checkbox name="prorateNewJoiners" label="Pro-rate joiners / leavers" defaultChecked={cur?.prorateNewJoiners ?? true} />
                </div>
              </fieldset>
              <fieldset className="rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-sm font-semibold text-slate-700">Attendance deductions (in days of per-day rate)</legend>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Per absent day" name="absentDeductionDays"><Input name="absentDeductionDays" required defaultValue={cur?.absentDeductionDays.toString() ?? "1"} /></Field>
                  <Field label="Per half day" name="halfDayDeductionDays"><Input name="halfDayDeductionDays" required defaultValue={cur?.halfDayDeductionDays.toString() ?? "0.5"} /></Field>
                  <Field label="Per unpaid leave day" name="unpaidLeaveDeductionDays"><Input name="unpaidLeaveDeductionDays" required defaultValue={cur?.unpaidLeaveDeductionDays.toString() ?? "1"} /></Field>
                </div>
              </fieldset>
              <fieldset className="rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-sm font-semibold text-slate-700">Late arrivals</legend>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <Field label="Penalty mode" name="latePenaltyMode" className="lg:col-span-2">
                    <Select name="latePenaltyMode" defaultValue={cur?.latePenaltyMode ?? "LATES_TO_ABSENT"}>
                      <option value="NONE">No penalty</option>
                      <option value="LATES_TO_ABSENT">N lates = 1 absent day</option>
                      <option value="FIXED_AMOUNT">Fixed amount per late</option>
                      <option value="FRACTION_OF_DAY">Fraction of a day per late</option>
                    </Select>
                  </Field>
                  <Field label="Lates per absent" name="latesPerAbsent"><Input name="latesPerAbsent" type="number" min={1} defaultValue={cur?.latesPerAbsent ?? 3} /></Field>
                  <Field label="Fixed amount" name="latePenaltyAmount"><Input name="latePenaltyAmount" defaultValue={cur?.latePenaltyAmount?.toString() ?? ""} /></Field>
                  <Field label="Day fraction" name="latePenaltyDayFraction"><Input name="latePenaltyDayFraction" defaultValue={cur?.latePenaltyDayFraction?.toString() ?? ""} placeholder="0.25" /></Field>
                  <Field label="Free lates per month" name="lateGraceCount"><Input name="lateGraceCount" type="number" min={0} defaultValue={cur?.lateGraceCount ?? 0} /></Field>
                </div>
              </fieldset>
              <fieldset className="rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-sm font-semibold text-slate-700">Rounding</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Mode" name="roundingMode"><Select name="roundingMode" defaultValue={cur?.roundingMode ?? "HALF_UP"}><option value="HALF_UP">Half up</option><option value="FLOOR">Floor</option><option value="CEIL">Ceiling</option></Select></Field>
                  <Field label="Decimal places" name="roundingPrecision"><Select name="roundingPrecision" defaultValue={String(cur?.roundingPrecision ?? 0)}><option value="0">0 (whole rupees)</option><option value="1">1</option><option value="2">2</option></Select></Field>
                </div>
              </fieldset>
              <div className="flex justify-end"><SubmitButton pendingText="Saving…">Save policy version</SubmitButton></div>
            </ActionForm>
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Alert variant="info" title="How salary is computed">
            per-day rate = base ÷ divisor. Deductions = (absent × factor + half days × factor + unpaid leave × factor + late penalty + days not employed) × rate. Then recurring components, bonuses and deductions are applied and the result is rounded. Every payslip stores the exact rules used.
          </Alert>
          <Card>
            <CardHeader title="Policy versions" />
            <Table>
              <THead><tr><TH>Effective</TH><TH>Name</TH><TH>Basis</TH></tr></THead>
              <TBody>{policies.map((p, i) => <TR key={p.id}><TD>{formatYmd(p.effectiveFrom)}{i === 0 && <Badge tone="green" className="ml-2">Current</Badge>}</TD><TD>{p.name}</TD><TD className="text-xs">{p.salaryBasis.replace("_", " ").toLowerCase()}{p.fixedDivisor ? ` (${p.fixedDivisor})` : ""}</TD></TR>)}</TBody>
            </Table>
          </Card>
        </div>
      </div>
    </>
  );
}
