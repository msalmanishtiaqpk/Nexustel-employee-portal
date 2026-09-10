import type { EmployeeDetail } from "@/server/services/employees";
import { Field } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { dbToYmd } from "@/lib/dates";

interface Props {
  employee?: EmployeeDetail;
  departments: { id: string; name: string }[];
  managers: { id: string; employeeCode: string; firstName: string; lastName: string }[];
  schedules?: { id: string; name: string }[];
  defaultScheduleId?: string | null;
  mode: "create" | "edit";
}

const ymd = (d: Date | null | undefined) => (d ? dbToYmd(d) : "");

export function EmployeeFormFields({ employee: e, departments, managers, schedules, defaultScheduleId, mode }: Props) {
  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Identity & account</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="First name" name="firstName"><Input name="firstName" required defaultValue={e?.firstName} /></Field>
          <Field label="Last name" name="lastName"><Input name="lastName" required defaultValue={e?.lastName} /></Field>
          <Field label="Employee code" name="employeeCode" hint={mode === "create" ? "Leave blank to auto-generate (NT-0001…)" : undefined}><Input name="employeeCode" defaultValue={e?.employeeCode} placeholder="NT-0042" /></Field>
          <Field label="Work email (login)" name="email"><Input name="email" type="email" required defaultValue={e?.user.email} /></Field>
          <Field label="Portal role" name="role" hint="Administrators can manage everyone's data.">
            <Select name="role" defaultValue={e?.user.role ?? "EMPLOYEE"}><option value="EMPLOYEE">Employee</option><option value="ADMIN">Administrator</option></Select>
          </Field>
          <Field label="Phone" name="phone"><Input name="phone" defaultValue={e?.phone ?? ""} /></Field>
        </div>
      </section>
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Employment</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Department" name="departmentId">
            <Select name="departmentId" defaultValue={e?.departmentId ?? ""}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
          </Field>
          <Field label="Designation" name="designation"><Input name="designation" defaultValue={e?.designation ?? ""} /></Field>
          <Field label="Employment type" name="employmentType">
            <Select name="employmentType" defaultValue={e?.employmentType ?? "FULL_TIME"}>
              <option value="FULL_TIME">Full-time</option><option value="PART_TIME">Part-time</option><option value="CONTRACT">Contract</option><option value="INTERN">Intern</option><option value="PROBATION">Probation</option>
            </Select>
          </Field>
          <Field label="Reports to" name="managerId">
            <Select name="managerId" defaultValue={e?.managerId ?? ""}><option value="">—</option>{managers.filter((m) => m.id !== e?.id).map((m) => <option key={m.id} value={m.id}>{m.employeeCode} · {m.firstName} {m.lastName}</option>)}</Select>
          </Field>
          <Field label="Joined on" name="joinedAt"><Input name="joinedAt" type="date" required defaultValue={ymd(e?.joinedAt)} /></Field>
          <Field label="Probation ends" name="probationEndsAt"><Input name="probationEndsAt" type="date" defaultValue={ymd(e?.probationEndsAt)} /></Field>
          {mode === "edit" && <Field label="Terminated on" name="terminatedAt" hint="Set when the employee leaves; payroll pro-rates the final month."><Input name="terminatedAt" type="date" defaultValue={ymd(e?.terminatedAt)} /></Field>}
          {mode === "create" && (
            <>
              <Field label="Monthly base salary" name="baseSalary"><Input name="baseSalary" inputMode="decimal" required placeholder="60000" /></Field>
              <Field label="Work schedule" name="scheduleId">
                <Select name="scheduleId" defaultValue={defaultScheduleId ?? ""}><option value="">Company default</option>{schedules?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
              </Field>
            </>
          )}
        </div>
      </section>
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Personal</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Date of birth" name="dateOfBirth"><Input name="dateOfBirth" type="date" defaultValue={ymd(e?.dateOfBirth)} /></Field>
          <Field label="Gender" name="gender"><Select name="gender" defaultValue={e?.gender ?? ""}><option value="">—</option><option>Female</option><option>Male</option><option>Other</option></Select></Field>
          <Field label="Personal email" name="personalEmail"><Input name="personalEmail" type="email" defaultValue={e?.personalEmail ?? ""} /></Field>
          <Field label="National ID (CNIC)" name="nationalId" hint="Stored encrypted."><Input name="nationalId" defaultValue={e?.nationalId ?? ""} placeholder="35202-1234567-1" /></Field>
          <Field label="Emergency contact name" name="emergencyContactName"><Input name="emergencyContactName" defaultValue={e?.emergencyContactName ?? ""} /></Field>
          <Field label="Emergency contact phone" name="emergencyContactPhone"><Input name="emergencyContactPhone" defaultValue={e?.emergencyContactPhone ?? ""} /></Field>
          <Field label="Address" name="address" className="sm:col-span-2 lg:col-span-3"><Textarea name="address" defaultValue={e?.address ?? ""} /></Field>
        </div>
      </section>
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Bank (for payslips)</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Bank name" name="bankName"><Input name="bankName" defaultValue={e?.bankName ?? ""} /></Field>
          <Field label="Account title" name="bankAccountTitle"><Input name="bankAccountTitle" defaultValue={e?.bankAccountTitle ?? ""} /></Field>
          <Field label="Account number / IBAN" name="bankAccount" hint="Stored encrypted."><Input name="bankAccount" defaultValue={e?.bankAccount ?? ""} /></Field>
          <Field label="Internal notes" name="notes" className="sm:col-span-2 lg:col-span-3"><Textarea name="notes" defaultValue={e?.notes ?? ""} /></Field>
        </div>
      </section>
    </div>
  );
}
