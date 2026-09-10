import { requireAdminPage } from "@/server/rbac";
import { createScheduleAction } from "@/server/actions/schedules";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ActionForm } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/button";
import { ScheduleFormFields } from "@/components/admin/schedule-form";

export default async function NewSchedulePage() {
  await requireAdminPage();
  return (
    <>
      <PageHeader title="New work schedule" breadcrumbs={[{ label: "Schedules", href: "/admin/schedules" }, { label: "New" }]} />
      <Card><CardBody>
        <ActionForm action={createScheduleAction} redirectTo="/admin/schedules">
          <ScheduleFormFields />
          <div className="flex justify-end"><SubmitButton pendingText="Saving…">Create schedule</SubmitButton></div>
        </ActionForm>
      </CardBody></Card>
    </>
  );
}
