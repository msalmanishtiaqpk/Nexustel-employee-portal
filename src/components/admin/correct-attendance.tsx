"use client";
import { Pencil } from "lucide-react";
import { DialogButton } from "@/components/ui/dialog";
import { ActionForm, Field } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/button";
import { correctAttendanceAction } from "@/server/actions/attendance";
import type { AttendanceStatus } from "@prisma/client";

const STATUSES: [AttendanceStatus, string][] = [["PRESENT", "Present"], ["LATE", "Late"], ["HALF_DAY", "Half day"], ["ABSENT", "Absent"], ["LEAVE", "Leave"], ["HOLIDAY", "Holiday"], ["WEEKLY_OFF", "Weekly off"]];

export function CorrectAttendanceButton({ employeeId, employeeName, date, current, locked, small, defaultTime }: { employeeId: string; employeeName: string; date: string; current: AttendanceStatus | null; locked?: boolean; small?: boolean; defaultTime?: string }) {
  if (locked) return <span className="text-xs text-slate-400" title="Payroll finalized">Locked</span>;
  return (
    <DialogButton title={`Correct attendance · ${employeeName} · ${date}`} label={<><Pencil className="h-3.5 w-3.5" /> Correct</>} variant="outline" size={small ? "sm" : "md"}>
      <ActionForm action={correctAttendanceAction}>
        <input type="hidden" name="employeeId" value={employeeId} />
        <input type="hidden" name="attendanceDate" value={date} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New status" name="status">
            <Select name="status" defaultValue={current ?? "PRESENT"}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          </Field>
          <Field label="Check-in time" name="checkInTime" hint="Company time. Leave blank to use the shift start (or keep existing).">
            <Input name="checkInTime" type="time" defaultValue={defaultTime ?? ""} />
          </Field>
        </div>
        <Field label="Reason (recorded in the audit trail)" name="reason"><Textarea name="reason" required placeholder="e.g. Employee was on client call at check-in time" /></Field>
        <div className="flex justify-end"><SubmitButton pendingText="Saving…"><Pencil className="h-4 w-4" /> Save correction</SubmitButton></div>
      </ActionForm>
    </DialogButton>
  );
}
