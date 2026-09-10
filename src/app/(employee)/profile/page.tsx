import type { Metadata } from "next";
import { requireEmployeePage } from "@/server/rbac";
import { getMyProfile } from "@/server/services/employees";
import { formatYmd, minutesToLabel } from "@/lib/dates";
import { PageHeader, DescriptionList } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionForm, Field } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/button";
import { updateMyContactAction } from "@/server/actions/employees";
import { ActiveBadge } from "@/components/ui/badge";
import Link from "next/link";

export const metadata: Metadata = { title: "My profile" };

const EMPLOYMENT: Record<string, string> = { FULL_TIME: "Full-time", PART_TIME: "Part-time", CONTRACT: "Contract", INTERN: "Intern", PROBATION: "Probation" };
const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function ProfilePage() {
  const actor = await requireEmployeePage();
  const p = await getMyProfile(actor);
  const schedule = p.schedules.find((s) => !s.effectiveTo)?.schedule ?? p.schedules[0]?.schedule;

  return (
    <>
      <PageHeader title={`${p.firstName} ${p.lastName}`} description={<span className="inline-flex items-center gap-2">{p.employeeCode} · {p.designation ?? "Employee"} <ActiveBadge active={p.isActive} /></span>} actions={<Link href="/change-password" className="text-sm text-brand-700 hover:underline">Change password</Link>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Employment information" description="Maintained by HR." />
          <CardBody>
            <DescriptionList items={[
              { label: "Employee code", value: p.employeeCode }, { label: "Work email", value: p.user.email },
              { label: "Department", value: p.department?.name }, { label: "Designation", value: p.designation },
              { label: "Employment type", value: EMPLOYMENT[p.employmentType] }, { label: "Reports to", value: p.manager ? `${p.manager.firstName} ${p.manager.lastName}` : "—" },
              { label: "Joined", value: formatYmd(p.joinedAt) }, { label: "Probation ends", value: p.probationEndsAt ? formatYmd(p.probationEndsAt) : "—" },
              { label: "Work schedule", value: schedule ? `${schedule.name}` : "Company default" },
              { label: "Shift", value: schedule ? `${minutesToLabel(schedule.shiftStartMin)} – ${minutesToLabel(schedule.shiftEndMin)} · ${schedule.workingDays.map((d) => DAYS[d]).join(", ")}` : "—" },
              { label: "Bank", value: [p.bankName, p.bankAccount].filter(Boolean).join(" · ") || "—" }, { label: "National ID", value: p.nationalId ?? "—" },
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Personal & contact details" description="You can update your contact information here." />
          <CardBody>
            <DescriptionList items={[{ label: "Date of birth", value: p.dateOfBirth ? formatYmd(p.dateOfBirth) : "—" }, { label: "Gender", value: p.gender }]} />
            <ActionForm action={updateMyContactAction} className="mt-6">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Phone" htmlFor="phone" name="phone"><Input id="phone" name="phone" defaultValue={p.phone ?? ""} /></Field>
                    <Field label="Personal email" htmlFor="personalEmail" name="personalEmail"><Input id="personalEmail" name="personalEmail" type="email" defaultValue={p.personalEmail ?? ""} /></Field>
                  </div>
                  <Field label="Address" name="address" htmlFor="address"><Textarea id="address" name="address" defaultValue={p.address ?? ""} /></Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Emergency contact name" name="emergencyContactName" htmlFor="emergencyContactName"><Input id="emergencyContactName" name="emergencyContactName" defaultValue={p.emergencyContactName ?? ""} /></Field>
                    <Field label="Emergency contact phone" name="emergencyContactPhone" htmlFor="emergencyContactPhone"><Input id="emergencyContactPhone" name="emergencyContactPhone" defaultValue={p.emergencyContactPhone ?? ""} /></Field>
                  </div>
                  <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
