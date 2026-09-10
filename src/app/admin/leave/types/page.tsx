import { requireAdminPage } from "@/server/rbac";
import { listLeaveTypes } from "@/server/services/leave";
import { upsertLeaveTypeAction } from "@/server/actions/leave";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionForm, Field } from "@/components/ui/form";
import { Checkbox, Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/button";
import type { LeaveType } from "@prisma/client";

function LeaveTypeForm({ t }: { t?: LeaveType }) {
  return (
    <ActionForm action={upsertLeaveTypeAction} resetOnSuccess={!t}>
      <input type="hidden" name="id" value={t?.id ?? ""} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" name="name"><Input name="name" required defaultValue={t?.name} /></Field>
        <Field label="Code" name="code"><Input name="code" required defaultValue={t?.code} placeholder="ANNUAL" /></Field>
        <Field label="Annual quota (days)" name="annualQuotaDays" hint="Blank = unlimited"><Input name="annualQuotaDays" defaultValue={t?.annualQuotaDays?.toString() ?? ""} placeholder="14" /></Field>
        <Field label="Minimum notice (days)" name="minNoticeDays"><Input name="minNoticeDays" type="number" min={0} defaultValue={t?.minNoticeDays ?? 0} /></Field>
      </div>
      <div className="flex flex-wrap gap-4">
        <Checkbox name="isPaid" label="Paid leave" defaultChecked={t?.isPaid ?? true} />
        <Checkbox name="allowHalfDay" label="Allow half day" defaultChecked={t?.allowHalfDay ?? false} />
        <Checkbox name="isActive" label="Active" defaultChecked={t?.isActive ?? true} />
      </div>
      <div className="flex justify-end"><SubmitButton size="sm" pendingText="Saving…">{t ? "Save" : "Create"}</SubmitButton></div>
    </ActionForm>
  );
}

export default async function LeaveTypesPage() {
  await requireAdminPage();
  const types = await listLeaveTypes();
  return (
    <>
      <PageHeader title="Leave types" breadcrumbs={[{ label: "Leave", href: "/admin/leave" }, { label: "Types" }]} description="Unpaid types are deducted from salary per the payroll policy. Quotas are per calendar year." />
      <div className="grid gap-6 lg:grid-cols-2">
        {types.map((t) => (
          <Card key={t.id}><CardHeader title={t.name} description={`${t.code} · ${t.isPaid ? "paid" : "unpaid"} · ${t.annualQuotaDays ? `${t.annualQuotaDays} days/yr` : "unlimited"}${t.isActive ? "" : " · inactive"}`} /><CardBody><LeaveTypeForm t={t} /></CardBody></Card>
        ))}
        <Card className="border-dashed"><CardHeader title="New leave type" /><CardBody><LeaveTypeForm /></CardBody></Card>
      </div>
    </>
  );
}
