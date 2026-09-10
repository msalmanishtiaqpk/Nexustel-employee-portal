import { requireAdmin } from "@/server/rbac";
import { adminGetPayslip } from "@/server/services/payroll/run";
import { renderPayslipPdf } from "@/server/services/payroll/pdf";
import { getSettings } from "@/server/services/settings";
import { fileResponse, handleApiError } from "@/server/api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin();
    const { id } = await ctx.params;
    const p = await adminGetPayslip(actor, id);
    const s = await getSettings();
    return fileResponse(await renderPayslipPdf(p, s), `payslip_${p.payslipNumber ?? p.id}.pdf`, "application/pdf");
  } catch (e) {
    return handleApiError(e);
  }
}
