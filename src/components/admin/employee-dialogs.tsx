"use client";
import { DialogButton } from "@/components/ui/dialog";
import { ActionForm, Field, ResultValue } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { assignScheduleAction, resetPasswordAction, setEmployeeActiveAction, setSalaryAction } from "@/server/actions/employees";
import { adjustBalanceAction } from "@/server/actions/leave";
import { SalaryComponentsEditor } from "@/components/admin/salary-components-editor";

export function SetSalaryDialog({ employeeId, today, current }: { employeeId: string; today: string; current?: { baseSalary: string; components: { name: string; kind: "BONUS" | "DEDUCTION"; amount: string; isProrated: boolean }[] } | null }) {
  return (
    <DialogButton title="Set salary" wide>
      <ActionForm action={setSalaryAction}>
        <input type="hidden" name="employeeId" value={employeeId} />
        <Alert variant="info">Creates a new effective-dated salary record. The previous record is closed the day before. Payroll for each month uses the salary in effect at month end.</Alert>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Monthly base salary" name="baseSalary"><Input name="baseSalary" inputMode="decimal" required defaultValue={current?.baseSalary ?? ""} /></Field>
          <Field label="Effective from" name="effectiveFrom"><Input name="effectiveFrom" type="date" required defaultValue={today} /></Field>
          <Field label="Reason" name="reason"><Input name="reason" placeholder="Annual increment" /></Field>
        </div>
        <SalaryComponentsEditor initial={current?.components ?? []} />
        <div className="flex justify-end"><SubmitButton pendingText="Saving…">Save salary</SubmitButton></div>
      </ActionForm>
    </DialogButton>
  );
}

export function AssignScheduleDialog({ employeeId, today, schedules, currentId }: { employeeId: string; today: string; schedules: { id: string; name: string }[]; currentId?: string | null }) {
  return (
    <DialogButton title="Assign work schedule" label="Assign schedule" variant="outline">
      <ActionForm action={assignScheduleAction}>
        <input type="hidden" name="employeeId" value={employeeId} />
        <Field label="Schedule" name="scheduleId"><Select name="scheduleId" required defaultValue={currentId ?? ""}><option value="" disabled>Select…</option>{schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Effective from" name="effectiveFrom" hint="Attendance from this date onwards follows the new schedule."><Input name="effectiveFrom" type="date" required defaultValue={today} /></Field>
        <div className="flex justify-end"><SubmitButton pendingText="Saving…">Assign</SubmitButton></div>
      </ActionForm>
    </DialogButton>
  );
}

export function ResetPasswordDialog({ employeeId }: { employeeId: string }) {
  return (
    <DialogButton title="Reset password" variant="outline">
      <ActionForm action={resetPasswordAction}>
        <input type="hidden" name="employeeId" value={employeeId} />
        <p className="text-sm text-slate-600">Generates a temporary password, signs the employee out everywhere and forces a password change at next login.</p>
        <ResultValue dataKey="tempPassword" label="Temporary password (shown once)" />
        <div className="flex justify-end"><SubmitButton variant="secondary" pendingText="Generating…">Generate temporary password</SubmitButton></div>
      </ActionForm>
    </DialogButton>
  );
}

export function ToggleActiveDialog({ employeeId, isActive }: { employeeId: string; isActive: boolean }) {
  return (
    <DialogButton title={isActive ? "Deactivate employee" : "Activate employee"} label={isActive ? "Deactivate" : "Activate"} variant={isActive ? "danger" : "primary"}>
      <ActionForm action={setEmployeeActiveAction}>
        <input type="hidden" name="employeeId" value={employeeId} />
        <input type="hidden" name="active" value={isActive ? "false" : "true"} />
        <p className="text-sm text-slate-600">
          {isActive ? "The employee will be signed out immediately and can no longer log in or mark attendance. History is kept. Set a termination date on the profile so payroll pro-rates the final month." : "The employee will be able to log in and mark attendance again."}
        </p>
        <div className="flex justify-end"><SubmitButton variant={isActive ? "danger" : "primary"}>{isActive ? "Deactivate" : "Activate"}</SubmitButton></div>
      </ActionForm>
    </DialogButton>
  );
}

export function AdjustBalanceDialog({ employeeId, year, types }: { employeeId: string; year: number; types: { id: string; name: string }[] }) {
  return (
    <DialogButton title={`Adjust leave balance · ${year}`} label="Adjust balance" variant="outline" size="sm">
      <ActionForm action={adjustBalanceAction}>
        <input type="hidden" name="employeeId" value={employeeId} />
        <input type="hidden" name="year" value={year} />
        <Field label="Leave type" name="leaveTypeId"><Select name="leaveTypeId" required>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        <Field label="Adjustment (days)" name="adjustmentDays" hint="Positive adds to the annual quota, negative removes. Replaces any earlier adjustment for this year."><Input name="adjustmentDays" required placeholder="2 or -1.5" /></Field>
        <div className="flex justify-end"><SubmitButton pendingText="Saving…">Save</SubmitButton></div>
      </ActionForm>
    </DialogButton>
  );
}

export function ReviewLeaveButtons({ id }: { id: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <DialogButton title="Approve leave request" label="Approve" size="sm">
        <ReviewForm id={id} decision="APPROVED" />
      </DialogButton>
      <DialogButton title="Reject leave request" label="Reject" size="sm" variant="outline">
        <ReviewForm id={id} decision="REJECTED" />
      </DialogButton>
    </div>
  );
}

import { reviewLeaveAction } from "@/server/actions/leave";
function ReviewForm({ id, decision }: { id: string; decision: "APPROVED" | "REJECTED" }) {
  return (
    <ActionForm action={reviewLeaveAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="decision" value={decision} />
      {decision === "APPROVED" && <p className="text-sm text-slate-600">Approving writes “Leave” attendance for each working day in the range (days already marked present are kept).</p>}
      <Field label="Note to employee (optional)" name="note"><Textarea name="note" /></Field>
      <div className="flex justify-end"><SubmitButton variant={decision === "APPROVED" ? "primary" : "danger"} pendingText="Saving…">{decision === "APPROVED" ? "Approve" : "Reject"}</SubmitButton></div>
    </ActionForm>
  );
}
