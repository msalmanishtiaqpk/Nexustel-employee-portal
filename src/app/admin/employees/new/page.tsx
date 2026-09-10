import { requireAdminPage } from "@/server/rbac";
import { listActiveEmployeesBrief, listDepartments } from "@/server/services/employees";
import { listSchedules } from "@/server/services/schedules";
import { getSettings } from "@/server/services/settings";
import { createEmployeeAction } from "@/server/actions/employees";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ActionForm, ResultLink, ResultValue } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/button";
import { EmployeeFormFields } from "@/components/admin/employee-form";
import { Alert } from "@/components/ui/alert";

export default async function NewEmployeePage() {
  const actor = await requireAdminPage();
  const [departments, managers, schedules, settings] = await Promise.all([listDepartments(), listActiveEmployeesBrief(actor), listSchedules(false), getSettings()]);
  return (
    <>
      <PageHeader title="New employee" breadcrumbs={[{ label: "Employees", href: "/admin/employees" }, { label: "New" }]} description="Creates the login, profile, initial salary record and schedule assignment in one step." />
      <Card>
        <CardBody>
          <ActionForm action={createEmployeeAction}>
            <Alert variant="info">A temporary password is generated on save. You will see it once on the next screen — share it securely; the employee must change it at first login.</Alert>
            <EmployeeFormFields mode="create" departments={departments.filter((d) => d.isActive)} managers={managers} schedules={schedules} defaultScheduleId={settings.defaultScheduleId} />
            <ResultValue dataKey="tempPassword" label="Temporary password (shown once)" />
            <div className="flex justify-end gap-2">
              <ResultLink href="/admin/employees/{employeeId}">Open employee record →</ResultLink>
              <SubmitButton pendingText="Creating…">Create employee</SubmitButton>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
