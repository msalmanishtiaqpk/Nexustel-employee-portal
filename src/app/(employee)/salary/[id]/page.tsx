import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { requireEmployeePage } from "@/server/rbac";
import { getMyPayslip } from "@/server/services/payroll/run";
import { NotFoundError } from "@/server/errors";
import { PayslipView } from "@/components/payslip-view";

export default async function MyPayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireEmployeePage();
  const { id } = await params;
  const payslip = await getMyPayslip(actor, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  return <PayslipView payslip={payslip} backHref="/salary" pdfHref={`/api/me/payslips/${payslip.id}/pdf`} icon={<Download className="h-4 w-4" />} />;
}
