import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAdminPage } from "@/server/rbac";
import { listDepartments, listEmployees } from "@/server/services/employees";
import { PageHeader } from "@/components/ui/page-header";
import { Card, EmptyState } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, Pagination } from "@/components/ui/table";
import { ActiveBadge, Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatYmd } from "@/lib/dates";

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdminPage();
  const sp = await searchParams;
  const active = (sp.active as "all" | "active" | "inactive") || "active";
  const page = Number(sp.page) || 1;
  const [list, departments] = await Promise.all([listEmployees(actor, { q: sp.q, departmentId: sp.departmentId, active, page }), listDepartments()]);
  const qs = (p: number) => `/admin/employees?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.departmentId ? { departmentId: sp.departmentId } : {}), active, page: String(p) })}`;

  return (
    <>
      <PageHeader title="Employees" description={`${list.total} record(s)`} actions={<Link href="/admin/employees/new"><Button><Plus className="h-4 w-4" /> New employee</Button></Link>} />
      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4" method="get">
          <Input name="q" placeholder="Search name, code, email…" defaultValue={sp.q ?? ""} className="w-64" aria-label="Search" />
          <Select name="departmentId" defaultValue={sp.departmentId ?? ""} className="w-48" aria-label="Department">
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select name="active" defaultValue={active} className="w-36" aria-label="Status">
            <option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option>
          </Select>
          <Button type="submit" variant="outline">Filter</Button>
        </form>
        {list.items.length === 0 ? <div className="p-5"><EmptyState title="No employees match" /></div> : (
          <Table>
            <THead><tr><TH>Code</TH><TH>Name</TH><TH>Department</TH><TH>Designation</TH><TH>Joined</TH><TH>Role</TH><TH>Status</TH></tr></THead>
            <TBody>
              {list.items.map((e) => (
                <TR key={e.id}>
                  <TD mono>{e.employeeCode}</TD>
                  <TD><Link href={`/admin/employees/${e.id}`} className="font-medium text-slate-900 hover:text-brand-700">{e.firstName} {e.lastName}</Link><p className="text-xs text-slate-500">{e.user.email}</p></TD>
                  <TD>{e.department?.name ?? "—"}</TD>
                  <TD>{e.designation ?? "—"}</TD>
                  <TD>{formatYmd(e.joinedAt)}</TD>
                  <TD>{e.user.role === "ADMIN" ? <Badge tone="gold">Admin</Badge> : <Badge>Employee</Badge>}</TD>
                  <TD><ActiveBadge active={e.isActive} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} hrefFor={qs} />
      </Card>
    </>
  );
}
