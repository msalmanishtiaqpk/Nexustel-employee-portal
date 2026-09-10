import { requireEmployeePage } from "@/server/rbac";
import { AppShell } from "@/components/layout/app-shell";
import type { NavItem } from "@/components/layout/nav-links";

const nav: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "LayoutDashboard", exact: true },
  { href: "/attendance", label: "Attendance", icon: "CalendarCheck" },
  { href: "/leave", label: "Leave", icon: "Plane" },
  { href: "/salary", label: "Salary & payslips", icon: "Wallet" },
  { href: "/profile", label: "My profile", icon: "UserCircle" },
];

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireEmployeePage();
  const items = actor.role === "ADMIN" ? [...nav, { href: "/admin", label: "Admin console", icon: "ShieldCheck" as const }] : nav;
  return (
    <AppShell actor={actor} nav={items} title="Employee portal">
      {children}
    </AppShell>
  );
}
