import { requireAdminPage } from "@/server/rbac";
import { AppShell } from "@/components/layout/app-shell";
import type { NavItem } from "@/components/layout/nav-links";

const nav: NavItem[] = [
  { href: "/admin", label: "Overview", icon: "LayoutDashboard", exact: true },
  { href: "/admin/employees", label: "Employees", icon: "Users" },
  { href: "/admin/attendance", label: "Attendance", icon: "CalendarCheck" },
  { href: "/admin/leave", label: "Leave", icon: "Plane" },
  { href: "/admin/payroll", label: "Payroll", icon: "Wallet" },
  { href: "/admin/schedules", label: "Schedules", icon: "Clock" },
  { href: "/admin/holidays", label: "Holidays & windows", icon: "CalendarDays" },
  { href: "/admin/reports", label: "Reports", icon: "FileSpreadsheet" },
  { href: "/admin/settings", label: "Settings", icon: "Settings" },
  { href: "/admin/audit", label: "Audit log", icon: "ScrollText" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireAdminPage();
  return (
    <AppShell actor={actor} nav={nav} title="Admin console">
      {children}
    </AppShell>
  );
}
