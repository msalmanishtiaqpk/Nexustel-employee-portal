import { requireAdminPage } from "@/server/rbac";
import { getSettings } from "@/server/services/settings";
import { listSchedules } from "@/server/services/schedules";
import { listDepartments } from "@/server/services/employees";
import { updateSettingsAction } from "@/server/actions/settings";
import { createDepartmentAction, setDepartmentActiveAction } from "@/server/actions/employees";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionForm, Field } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/button";
import { ActiveBadge } from "@/components/ui/badge";

export default async function SettingsPage() {
  await requireAdminPage();
  const [settings, schedules, departments] = await Promise.all([getSettings(), listSchedules(false), listDepartments()]);
  return (
    <>
      <PageHeader title="Settings" description="Company-wide configuration." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Company" />
          <CardBody>
            <ActionForm action={updateSettingsAction}>
              <Field label="Company name" name="companyName"><Input name="companyName" required defaultValue={settings.companyName} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Timezone (IANA)" name="timezone" hint="Attendance dates and payroll months use this zone."><Input name="timezone" required defaultValue={settings.timezone} /></Field>
                <Field label="Currency" name="currency"><Input name="currency" required maxLength={3} defaultValue={settings.currency} /></Field>
              </div>
              <Field label="Default work schedule" name="defaultScheduleId" hint="Applies to employees without an explicit assignment.">
                <Select name="defaultScheduleId" defaultValue={settings.defaultScheduleId ?? ""}><option value="">None</option>{schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
              </Field>
              <Field label="Attendance IP allowlist" name="attendanceIpAllowlist" hint="Comma or newline separated IPs / CIDRs, e.g. 203.0.113.10, 198.51.100.0/24. Leave empty to allow marking attendance from anywhere.">
                <Textarea name="attendanceIpAllowlist" defaultValue={settings.attendanceIpAllowlist.join("\n")} />
              </Field>
              <Field label="Payslip footer" name="payslipFooter"><Textarea name="payslipFooter" defaultValue={settings.payslipFooter ?? ""} /></Field>
              <div className="flex justify-end"><SubmitButton pendingText="Saving…">Save settings</SubmitButton></div>
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Departments" />
          <CardBody className="space-y-4">
            <ul className="divide-y divide-slate-100 text-sm">
              {departments.map((d) => (
                <li key={d.id} className="flex items-center justify-between py-2">
                  <span className="font-medium text-slate-800">{d.name} <span className="ml-1 text-xs text-slate-500">{d._count.employees} employee(s)</span></span>
                  <div className="flex items-center gap-2">
                    <ActiveBadge active={d.isActive} />
                    <ActionForm action={setDepartmentActiveAction} quiet className="inline"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="active" value={d.isActive ? "false" : "true"} /><SubmitButton variant="ghost" size="sm">{d.isActive ? "Deactivate" : "Activate"}</SubmitButton></ActionForm>
                  </div>
                </li>
              ))}
            </ul>
            <ActionForm action={createDepartmentAction} resetOnSuccess className="flex items-end gap-2">
              <Field label="New department" name="name" className="flex-1"><Input name="name" required placeholder="Quality Assurance" /></Field>
              <SubmitButton pendingText="Adding…">Add</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
