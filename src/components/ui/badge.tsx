import * as React from "react";
import type { AttendanceStatus, LeaveStatus, PayrollRunStatus } from "@prisma/client";
import { cn } from "@/lib/utils";

export function Badge({ className, children, tone = "slate" }: { className?: string; children: React.ReactNode; tone?: "slate" | "green" | "red" | "amber" | "blue" | "violet" | "gold" | "sky" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    red: "bg-rose-50 text-rose-700 ring-rose-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    blue: "bg-brand-50 text-brand-700 ring-brand-200",
    violet: "bg-violet-50 text-violet-700 ring-violet-200",
    gold: "bg-gold-100 text-gold-600 ring-gold-500/30",
    sky: "bg-sky-50 text-sky-700 ring-sky-200",
  };
  return <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone], className)}>{children}</span>;
}

export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: "Present", LATE: "Late", ABSENT: "Absent", LEAVE: "Leave", HALF_DAY: "Half day", HOLIDAY: "Holiday", WEEKLY_OFF: "Weekly off",
};
const attendanceTone: Record<AttendanceStatus, Parameters<typeof Badge>[0]["tone"]> = {
  PRESENT: "green", LATE: "amber", ABSENT: "red", LEAVE: "violet", HALF_DAY: "sky", HOLIDAY: "gold", WEEKLY_OFF: "slate",
};

export function AttendanceBadge({ status }: { status: AttendanceStatus | "PENDING" | "NOT_MARKED" }) {
  if (status === "PENDING") return <Badge tone="slate">Not yet marked</Badge>;
  if (status === "NOT_MARKED") return <Badge tone="slate">No schedule</Badge>;
  return <Badge tone={attendanceTone[status]}>{ATTENDANCE_LABEL[status]}</Badge>;
}

export function LeaveBadge({ status }: { status: LeaveStatus }) {
  const map: Record<LeaveStatus, [string, Parameters<typeof Badge>[0]["tone"]]> = { PENDING: ["Pending", "amber"], APPROVED: ["Approved", "green"], REJECTED: ["Rejected", "red"], CANCELLED: ["Cancelled", "slate"] };
  return <Badge tone={map[status][1]}>{map[status][0]}</Badge>;
}

export function RunBadge({ status }: { status: PayrollRunStatus }) {
  const map: Record<PayrollRunStatus, [string, Parameters<typeof Badge>[0]["tone"]]> = { DRAFT: ["Draft", "amber"], FINALIZED: ["Finalized", "green"], REOPENED: ["Reopened", "violet"] };
  return <Badge tone={map[status][1]}>{map[status][0]}</Badge>;
}

export function ActiveBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? "green" : "slate"}>{active ? "Active" : "Inactive"}</Badge>;
}
