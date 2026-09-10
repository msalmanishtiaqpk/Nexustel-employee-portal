import { requireEmployee } from "@/server/rbac";
import { getMyPayslip } from "@/server/services/payroll/run";
import { renderPayslipPdf } from "@/server/services/payroll/pdf";
import { getSettings } from "@/server/services/settings";
import { fileResponse, handleApiError } from "@/server/api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireEmployee();
    const { id } = await ctx.params;
    const p = await getMyPayslip(actor, id); // 404 unless it is the caller's own finalized payslip
    const s = await getSettings();
    const pdf = await renderPayslipPdf(p, s);
    return fileResponse(pdf, `payslip_${p.payslipNumber ?? p.id}.pdf`, "application/pdf");
  } catch (e) {
    return handleApiError(e);
  }
}
