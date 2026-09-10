import { requireAdminPage } from "@/server/rbac";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/services/settings";
import { formatInstant } from "@/lib/dates";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, Pagination } from "@/components/ui/table";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AuditAction, Prisma } from "@prisma/client";

const ACTIONS: AuditAction[] = ["LOGIN", "LOGIN_FAILED", "LOGOUT", "PASSWORD_CHANGE", "CREATE", "UPDATE", "DELETE", "ATTENDANCE_MARK", "ATTENDANCE_CORRECT", "LEAVE_REVIEW", "PAYROLL_RUN", "PAYROLL_FINALIZE", "PAYROLL_REOPEN", "EXPORT"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const settings = await getSettings();
  const page = Number(sp.page) || 1;
  const pageSize = 50;
  const where: Prisma.AuditLogWhereInput = {
    ...(sp.action && ACTIONS.includes(sp.action as AuditAction) ? { action: sp.action as AuditAction } : {}),
    ...(sp.entity ? { entityType: { contains: sp.entity, mode: "insensitive" } } : {}),
    ...(sp.actor ? { actor: { email: { contains: sp.actor, mode: "insensitive" } } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { actor: { select: { email: true } } } }),
    prisma.auditLog.count({ where }),
  ]);
  const qs = (p: number) => `/admin/audit?${new URLSearchParams({ ...(sp.action ? { action: sp.action } : {}), ...(sp.entity ? { entity: sp.entity } : {}), ...(sp.actor ? { actor: sp.actor } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Audit log" description="Every login, admin change, attendance mark/correction, payroll action and export." />
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Select name="action" defaultValue={sp.action ?? ""} className="w-48" aria-label="Action"><option value="">All actions</option>{ACTIONS.map((a) => <option key={a} value={a}>{a.replace(/_/g, " ").toLowerCase()}</option>)}</Select>
          <Input name="entity" placeholder="Entity type (e.g. Payslip)" defaultValue={sp.entity ?? ""} className="w-56" aria-label="Entity type" />
          <Input name="actor" placeholder="Actor email" defaultValue={sp.actor ?? ""} className="w-56" aria-label="Actor" />
          <Button type="submit" variant="outline">Filter</Button>
        </form>
        <Table>
          <THead><tr><TH>When</TH><TH>Actor</TH><TH>Action</TH><TH>Entity</TH><TH>Details</TH><TH>IP</TH></tr></THead>
          <TBody>
            {items.map((a) => (
              <TR key={a.id.toString()}>
                <TD className="whitespace-nowrap text-xs">{formatInstant(a.createdAt, settings.timezone, "dd MMM yyyy HH:mm:ss")}</TD>
                <TD className="text-xs">{a.actor?.email ?? <span className="text-slate-400">system / anonymous</span>}{a.actorRole && <Badge className="ml-1" tone={a.actorRole === "ADMIN" ? "gold" : "slate"}>{a.actorRole.toLowerCase()}</Badge>}</TD>
                <TD><Badge tone={a.action === "LOGIN_FAILED" || a.action === "DELETE" ? "red" : a.action.startsWith("PAYROLL") ? "violet" : "blue"}>{a.action.replace(/_/g, " ").toLowerCase()}</Badge></TD>
                <TD className="text-xs">{a.entityType}<p className="font-mono text-[10px] text-slate-400">{a.entityId ?? ""}</p></TD>
                <TD className="max-w-md"><details className="text-xs"><summary className="cursor-pointer text-brand-700">view</summary><pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-50 p-2 text-[10px] leading-tight">{JSON.stringify({ before: a.beforeData, after: a.afterData }, null, 1)}</pre></details></TD>
                <TD className="text-xs text-slate-500">{a.ipAddress ?? ""}</TD>
              </TR>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">No entries.</td></tr>}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} hrefFor={qs} />
      </Card>
    </>
  );
}
