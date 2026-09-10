import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAdminPage } from "@/server/rbac";
import { listSchedules } from "@/server/services/schedules";
import { getSettings } from "@/server/services/settings";
import { minutesToLabel } from "@/lib/dates";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActiveBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function SchedulesPage() {
  await requireAdminPage();
  const [schedules, settings] = await Promise.all([listSchedules(), getSettings()]);
  return (
    <>
      <PageHeader title="Work schedules" description="Shift templates with working days and attendance windows. Assign them to employees from the employee record." actions={<Link href="/admin/schedules/new"><Button><Plus className="h-4 w-4" /> New schedule</Button></Link>} />
      <Card>
        <Table>
          <THead><tr><TH>Name</TH><TH>Shift</TH><TH>Working days</TH><TH>Check-in window</TH><TH right>Assigned</TH><TH>Status</TH></tr></THead>
          <TBody>
            {schedules.map((s) => (
              <TR key={s.id}>
                <TD><Link href={`/admin/schedules/${s.id}`} className="font-medium text-slate-900 hover:text-brand-700">{s.name}</Link>{settings.defaultScheduleId === s.id && <Badge tone="gold" className="ml-2">Default</Badge>}</TD>
                <TD>{minutesToLabel(s.shiftStartMin)} – {minutesToLabel(s.shiftEndMin)}{s.shiftEndMin <= s.shiftStartMin && <span className="ml-1 text-xs text-slate-500">next day</span>}</TD>
                <TD>{s.workingDays.map((d) => DAYS[d]).join(", ")}</TD>
                <TD className="text-xs text-slate-600">opens −{s.checkinOpensMinBefore}m · late after +{s.lateAfterMin}m · half day after +{s.halfDayAfterMin}m · closes +{s.checkinClosesAfterMin}m</TD>
                <TD right mono>{s._count.assignments}</TD>
                <TD><ActiveBadge active={s.isActive} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
