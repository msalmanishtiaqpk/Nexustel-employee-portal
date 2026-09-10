import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { requireAdminPage } from "@/server/rbac";
import { adminGetPayslip } from "@/server/services/payroll/run";
import { NotFoundError } from "@/server/errors";
import { PayslipView } from "@/components/payslip-view";

export default async function AdminPayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdminPage();
  const { id } = await params;
  const p = await adminGetPayslip(actor, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  return <PayslipView payslip={p} backHref={`/admin/payroll/${p.run.periodYear}/${p.run.periodMonth}`} pdfHref={`/api/admin/payslips/${p.id}/pdf`} icon={<Download className="h-4 w-4" />} />;
}
