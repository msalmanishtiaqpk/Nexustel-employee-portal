import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/rbac";
import { requestMeta } from "@/server/auth/session";
import { payrollRegister, toCsv, toXlsx } from "@/server/services/reports";
import { fileResponse, handleApiError } from "@/server/api";
import { ValidationError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAdmin();
    const q = req.nextUrl.searchParams;
    const year = Number(q.get("year")), month = Number(q.get("month"));
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new ValidationError("year/month are required");
    const table = await payrollRegister(actor, year, month, await requestMeta());
    const name = `payroll_${year}-${String(month).padStart(2, "0")}`;
    if (q.get("format") === "xlsx") return fileResponse(await toXlsx([table]), `${name}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return fileResponse(toCsv(table), `${name}.csv`, "text/csv; charset=utf-8");
  } catch (e) {
    return handleApiError(e);
  }
}
