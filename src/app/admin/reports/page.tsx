import { requireAdminPage } from "@/server/rbac";
import { listActiveEmployeesBrief, listDepartments } from "@/server/services/employees";
import { listRuns } from "@/server/services/payroll/run";
import { getSettings } from "@/server/services/settings";
import { monthLabel, monthRange, previousMonth, currentYearMonth } from "@/lib/dates";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export default async function ReportsPage() {
  const actor = await requireAdminPage();
  const settings = await getSettings();
  const cur = currentYearMonth(settings.timezone);
  const prev = previousMonth(cur.year, cur.month);
  const range = monthRange(prev.year, prev.month);
  const [employees, departments, runs] = await Promise.all([listActiveEmployeesBrief(actor), listDepartments(), listRuns(actor)]);

  return (
    <>
      <PageHeader title="Reports & exports" description="Downloads are generated on demand and recorded in the audit log." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Attendance report" description="Daily records for a date range. XLSX includes a per-employee summary sheet." />
          <CardBody>
            <form action="/api/admin/reports/attendance" method="get" className="space-y-4" target="_blank">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-medium text-slate-700">From<Input name="from" type="date" required defaultValue={range.start} className="mt-1" /></label>
                <label className="text-sm font-medium text-slate-700">To<Input name="to" type="date" required defaultValue={range.end} className="mt-1" /></label>
              </div>
              <label className="block text-sm font-medium text-slate-700">Employee<Select name="employeeId" defaultValue="" className="mt-1"><option value="">All employees</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.employeeCode} · {e.firstName} {e.lastName}</option>)}</Select></label>
              <label className="block text-sm font-medium text-slate-700">Department<Select name="departmentId" defaultValue="" className="mt-1"><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></label>
              <div className="flex gap-2">
                <Button type="submit" name="format" value="xlsx"><Download className="h-4 w-4" /> Excel</Button>
                <Button type="submit" name="format" value="csv" variant="outline"><Download className="h-4 w-4" /> CSV</Button>
              </div>
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Payroll register" description="One row per payslip for a payroll run, including bank details (last 4 digits)." />
          <CardBody>
            {runs.length === 0 ? <p className="text-sm text-slate-500">No payroll runs yet.</p> : (
              <form action="/api/admin/reports/payroll" method="get" className="space-y-4" target="_blank">
                <label className="block text-sm font-medium text-slate-700">Period
                  <Select name="period" defaultValue={`${runs[0].periodYear}-${runs[0].periodMonth}`} className="mt-1" aria-hidden>
                    {runs.map((r) => <option key={r.id} value={`${r.periodYear}-${r.periodMonth}`}>{monthLabel(r.periodYear, r.periodMonth)} ({r.status.toLowerCase()})</option>)}
                  </Select>
                </label>
                <PeriodSplitter />
                <div className="flex gap-2">
                  <Button type="submit" name="format" value="xlsx"><Download className="h-4 w-4" /> Excel</Button>
                  <Button type="submit" name="format" value="csv" variant="outline"><Download className="h-4 w-4" /> CSV</Button>
                </div>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

/** Copies the selected "YYYY-M" period into the year/month fields the API expects. */
function PeriodSplitter() {
  return (
    <>
      <input type="hidden" name="year" /><input type="hidden" name="month" />
      <script dangerouslySetInnerHTML={{ __html: `(function(){var f=document.currentScript.closest('form');function s(){var v=f.period.value.split('-');f.year.value=v[0];f.month.value=v[1];}f.period.addEventListener('change',s);s();})();` }} />
    </>
  );
}
