import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { requireEmployeePage } from "@/server/rbac";
import { myPayslips, myProjectedSalary } from "@/server/services/payroll/run";
import { getMyProfile } from "@/server/services/employees";
import { getSettings } from "@/server/services/settings";
import { formatYmd, monthLabel, todayYmd } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";
import { PayslipBreakdown } from "@/components/payslip-breakdown";

export const metadata: Metadata = { title: "Salary & payslips" };

export default async function SalaryPage() {
  const actor = await requireEmployeePage();
  const settings = await getSettings();
  const [payslips, projected, profile] = await Promise.all([myPayslips(actor), myProjectedSalary(actor), getMyProfile(actor)]);
  const salary = profile.salaries.find((s) => !s.effectiveTo || s.effectiveTo > new Date(`${todayYmd(settings.timezone)}T00:00:00Z`));

  return (
    <>
      <PageHeader title="Salary & payslips" description="Your current month estimate and all finalized payslips." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Current package" />
          <CardBody>
            {salary ? (
              <>
                <p className="text-xs uppercase tracking-wide text-slate-500">Base salary (monthly)</p>
                <p className="font-display text-2xl font-semibold text-slate-900">{formatMoney(salary.baseSalary, salary.currency)}</p>
                <p className="mt-1 text-xs text-slate-500">Effective {formatYmd(salary.effectiveFrom)}</p>
                {salary.components.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {salary.components.map((c) => <li key={c.id} className="flex justify-between"><span className="text-slate-600">{c.name}{c.isProrated ? " (pro-rated)" : ""}</span><span className={c.kind === "DEDUCTION" ? "text-rose-700" : "text-slate-900"}>{c.kind === "DEDUCTION" ? "−" : "+"}{formatMoney(c.amount, salary.currency)}</span></li>)}
                  </ul>
                )}
              </>
            ) : <p className="text-sm text-slate-500">No salary record on file.</p>}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={projected.kind === "FINAL" ? `${monthLabel(projected.year, projected.month)} — final` : `${monthLabel(projected.year, projected.month)} — projection`} />
          <CardBody>
            {projected.kind === "PROJECTED" && (
              <>
                <Alert variant="info" className="mb-4">Estimate using attendance through {formatYmd(projected.through)}. Remaining scheduled days are assumed present. The final amount is determined when HR runs payroll.</Alert>
                <PayslipBreakdown lines={projected.result.lines} rulesApplied={projected.result.rulesApplied} currency={projected.rules.currency} gross={projected.result.grossPay.toString()} net={projected.result.netPay.toString()} />
              </>
            )}
            {projected.kind === "FINAL" && <p className="text-sm">Payroll for this month is finalized. <Link href={`/salary/${projected.payslip.id}`} className="text-brand-700 hover:underline">View payslip</Link>.</p>}
            {(projected.kind === "NO_POLICY" || projected.kind === "NO_SALARY") && <p className="text-sm text-slate-500">A projection isn&apos;t available yet.</p>}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Payslip history" />
        {payslips.length === 0 ? <div className="p-5"><EmptyState title="No payslips yet" description="Payslips appear here once HR finalizes a payroll run." /></div> : (
          <Table>
            <THead><tr><TH>Period</TH><TH>Payslip no.</TH><TH right>Gross</TH><TH right>Deductions</TH><TH right>Net pay</TH><TH></TH></tr></THead>
            <TBody>
              {payslips.map((p) => (
                <TR key={p.id}>
                  <TD className="font-medium text-slate-900"><Link href={`/salary/${p.id}`} className="hover:text-brand-700">{monthLabel(p.run.periodYear, p.run.periodMonth)}</Link></TD>
                  <TD mono>{p.payslipNumber}</TD>
                  <TD right mono>{formatMoney(p.grossPay, p.currency)}</TD>
                  <TD right mono>{formatMoney(p.grossPay.minus(p.netPay), p.currency)}</TD>
                  <TD right mono className="font-semibold">{formatMoney(p.netPay, p.currency)}</TD>
                  <TD right><a href={`/api/me/payslips/${p.id}/pdf`} className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"><Download className="h-4 w-4" /> PDF</a></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
