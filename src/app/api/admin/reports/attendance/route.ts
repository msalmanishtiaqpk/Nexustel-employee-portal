import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/rbac";
import { requestMeta } from "@/server/auth/session";
import { attendanceReport, attendanceSummaryReport, toCsv, toXlsx } from "@/server/services/reports";
import { fileResponse, handleApiError } from "@/server/api";
import { isYmd } from "@/lib/dates";
import { ValidationError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAdmin();
    const q = req.nextUrl.searchParams;
    const from = q.get("from"), to = q.get("to");
    if (!isYmd(from) || !isYmd(to)) throw new ValidationError("from/to must be YYYY-MM-DD");
    const format = q.get("format") === "xlsx" ? "xlsx" : "csv";
    const f = { from, to, employeeId: q.get("employeeId") || null, departmentId: q.get("departmentId") || null };
    const detail = await attendanceReport(actor, f, await requestMeta());
    const name = `attendance_${from}_${to}`;
    if (format === "csv") return fileResponse(toCsv(detail), `${name}.csv`, "text/csv; charset=utf-8");
    const summary = await attendanceSummaryReport(actor, f);
    return fileResponse(await toXlsx([detail, summary]), `${name}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  } catch (e) {
    return handleApiError(e);
  }
}
