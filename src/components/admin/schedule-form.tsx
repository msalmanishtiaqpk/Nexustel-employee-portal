import type { WorkSchedule } from "@prisma/client";
import { Field } from "@/components/ui/form";
import { Checkbox, Input } from "@/components/ui/input";
import { minutesToHHMM } from "@/lib/dates";

const DAYS: [number, string][] = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]];

export function ScheduleFormFields({ s }: { s?: WorkSchedule }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name"><Input name="name" required defaultValue={s?.name} placeholder="US night shift (20:00–05:00)" /></Field>
        <Field label="Timezone (IANA)" name="timezone"><Input name="timezone" required defaultValue={s?.timezone ?? "Asia/Karachi"} /></Field>
        <Field label="Shift start" name="shiftStart"><Input name="shiftStart" type="time" required defaultValue={s ? minutesToHHMM(s.shiftStartMin) : "09:00"} /></Field>
        <Field label="Shift end" name="shiftEnd" hint="An end time earlier than the start means the shift crosses midnight."><Input name="shiftEnd" type="time" required defaultValue={s ? minutesToHHMM(s.shiftEndMin) : "18:00"} /></Field>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Working days</p>
        <div className="flex flex-wrap gap-3">{DAYS.map(([v, l]) => <Checkbox key={v} name="workingDays[]" value={v} label={l} defaultChecked={s ? s.workingDays.includes(v) : v <= 5} />)}</div>
        <p className="mt-1 text-xs text-slate-500">Unchecked days are weekly offs.</p>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Attendance window (minutes relative to shift start)</p>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Opens before" name="checkinOpensMinBefore"><Input name="checkinOpensMinBefore" type="number" min={0} required defaultValue={s?.checkinOpensMinBefore ?? 60} /></Field>
          <Field label="Late after" name="lateAfterMin" hint="Grace period"><Input name="lateAfterMin" type="number" min={0} required defaultValue={s?.lateAfterMin ?? 15} /></Field>
          <Field label="Half day after" name="halfDayAfterMin"><Input name="halfDayAfterMin" type="number" min={0} required defaultValue={s?.halfDayAfterMin ?? 240} /></Field>
          <Field label="Closes after" name="checkinClosesAfterMin" hint="No self check-in afterwards"><Input name="checkinClosesAfterMin" type="number" min={1} required defaultValue={s?.checkinClosesAfterMin ?? 480} /></Field>
        </div>
      </div>
      {s && <Checkbox name="isActive" label="Active (available for assignment)" defaultChecked={s.isActive} />}
    </div>
  );
}
