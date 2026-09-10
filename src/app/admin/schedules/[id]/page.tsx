import { notFound } from "next/navigation";
import { requireAdminPage } from "@/server/rbac";
import { getSchedule } from "@/server/services/schedules";
import { NotFoundError } from "@/server/errors";
import { updateScheduleAction } from "@/server/actions/schedules";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ActionForm } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ScheduleFormFields } from "@/components/admin/schedule-form";

export default async function EditSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const s = await getSchedule(id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  return (
    <>
      <PageHeader title={s.name} breadcrumbs={[{ label: "Schedules", href: "/admin/schedules" }, { label: s.name }]} />
      <Card><CardBody>
        <ActionForm action={updateScheduleAction}>
          <input type="hidden" name="id" value={s.id} />
          <Alert variant="warning">Changes apply to future attendance for every employee on this schedule. Existing records are not recalculated.</Alert>
          <ScheduleFormFields s={s} />
          <div className="flex justify-end"><SubmitButton pendingText="Saving…">Save changes</SubmitButton></div>
        </ActionForm>
      </CardBody></Card>
    </>
  );
}
