import Link from "next/link";
import type { PayslipDetail } from "@/server/services/payroll/run";
import type { BreakdownLine } from "@/server/services/payroll/engine";
import { monthLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { PageHeader, DescriptionList } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { RunBadge } from "@/components/ui/badge";
import { PayslipBreakdown } from "@/components/payslip-breakdown";

export function PayslipView({ payslip: p, backHref, pdfHref, icon }: { payslip: PayslipDetail; backHref: string; pdfHref: string; icon?: React.ReactNode }) {
  const snap = p.employeeSnapshot as Record<string, string | null>;
  const bd = p.breakdown as unknown as { lines: BreakdownLine[]; rulesApplied: string[] };
  return (
    <>
      <PageHeader
        title={`Payslip · ${monthLabel(p.run.periodYear, p.run.periodMonth)}`}
        description={<span className="inline-flex items-center gap-2">{p.payslipNumber ?? "Draft"} <RunBadge status={p.run.status} /></span>}
        breadcrumbs={[{ label: "Back", href: backHref }]}
        actions={<a href={pdfHref} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">{icon} Download PDF</a>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Employee" />
          <CardBody>
            <DescriptionList cols={1} items={[
              { label: "Name", value: `${snap.firstName ?? ""} ${snap.lastName ?? ""}` },
              { label: "Employee code", value: snap.employeeCode },
              { label: "Designation", value: snap.designation },
              { label: "Department", value: snap.department },
              { label: "Bank", value: snap.bankName ? `${snap.bankName} ••••${snap.bankAccountLast4 ?? ""}` : "—" },
            ]} />
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Attendance" />
          <CardBody>
            <DescriptionList cols={3} items={[
              { label: "Calendar days", value: p.calendarDays }, { label: "Working days", value: p.workingDays }, { label: "Payable days", value: p.payableDays.toString() },
              { label: "Present", value: p.presentDays }, { label: "Late", value: p.lateDays }, { label: "Half days", value: p.halfDays },
              { label: "Absent", value: p.absentDays }, { label: "Paid leave", value: p.paidLeaveDays.toString() }, { label: "Unpaid leave", value: p.unpaidLeaveDays.toString() },
              { label: "Holidays", value: p.holidayDays }, { label: "Weekly offs", value: p.weeklyOffDays }, { label: "Per-day rate", value: formatMoney(p.perDayRate, p.currency, 2) },
            ]} />
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Calculation" />
        <CardBody><PayslipBreakdown lines={bd.lines} rulesApplied={bd.rulesApplied} currency={p.currency} gross={p.grossPay.toString()} net={p.netPay.toString()} /></CardBody>
      </Card>
      <p className="mt-4 text-xs text-slate-500"><Link href={backHref} className="hover:underline">← Back</Link></p>
    </>
  );
}
