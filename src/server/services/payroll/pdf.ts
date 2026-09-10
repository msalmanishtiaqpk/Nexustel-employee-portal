import PDFDocument from "pdfkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PayslipDetail } from "@/server/services/payroll/run";
import type { BreakdownLine } from "@/server/services/payroll/engine";
import { formatMoney } from "@/lib/money";
import { formatInstant, monthLabel } from "@/lib/dates";

const BLUE = "#2563eb";
const GOLD = "#b8863a";
const INK = "#0f172a";
const MUTED = "#64748b";

export async function renderPayslipPdf(p: PayslipDetail, company: { companyName: string; payslipFooter: string | null; timezone: string }): Promise<Buffer> {
  const snap = p.employeeSnapshot as Record<string, string | null>;
  const salary = p.salarySnapshot as { baseSalary: string; currency: string };
  const bd = p.breakdown as unknown as { lines: BreakdownLine[]; rulesApplied: string[] };
  const cur = p.currency;
  const money = (v: unknown) => formatMoney(String(v), cur, 2);

  let logo: Buffer | null = null;
  try { logo = await readFile(path.join(process.cwd(), "public", "brand", "logo-light.png")); } catch { logo = null; }

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Payslip ${p.payslipNumber ?? ""}`, Author: company.companyName } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width - 96;
    // Header band
    doc.rect(0, 0, doc.page.width, 92).fill(INK);
    if (logo) doc.image(logo, 48, 20, { height: 52 });
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(18).text(company.companyName, 110, 28);
    doc.font("Helvetica").fontSize(10).fillColor("#cbd5e1").text("Employee payslip", 110, 52);
    doc.font("Helvetica-Bold").fontSize(16).fillColor(GOLD).text(monthLabel(p.run.periodYear, p.run.periodMonth), 48, 30, { width: W, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor("#cbd5e1").text(`Payslip No. ${p.payslipNumber ?? "DRAFT"}`, 48, 54, { width: W, align: "right" });

    doc.moveDown(4);
    let y = 116;
    const col = (x: number, label: string, value: string) => {
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(label.toUpperCase(), x, y);
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK).text(value || "—", x, y + 11, { width: 160 });
    };
    col(48, "Employee", `${snap.firstName ?? ""} ${snap.lastName ?? ""}`.trim());
    col(228, "Employee code", snap.employeeCode ?? "");
    col(408, "Designation", snap.designation ?? "");
    y += 40;
    col(48, "Department", snap.department ?? "");
    col(228, "Joined", snap.joinedAt ?? "");
    col(408, "Bank", snap.bankName ? `${snap.bankName} ••••${snap.bankAccountLast4 ?? ""}` : "—");
    y += 48;

    // Attendance summary
    doc.font("Helvetica-Bold").fontSize(11).fillColor(BLUE).text("Attendance summary", 48, y);
    y += 18;
    const stats: [string, string][] = [
      ["Calendar days", String(p.calendarDays)], ["Working days", String(p.workingDays)], ["Payable days", p.payableDays.toString()],
      ["Present", String(p.presentDays)], ["Late", String(p.lateDays)], ["Half days", String(p.halfDays)], ["Absent", String(p.absentDays)],
      ["Paid leave", p.paidLeaveDays.toString()], ["Unpaid leave", p.unpaidLeaveDays.toString()], ["Holidays", String(p.holidayDays)], ["Weekly offs", String(p.weeklyOffDays)],
    ];
    const cellW = W / 6;
    stats.forEach((s, i) => {
      const cx = 48 + (i % 6) * cellW;
      const cy = y + Math.floor(i / 6) * 34;
      doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(s[0].toUpperCase(), cx, cy, { width: cellW });
      doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(s[1], cx, cy + 10, { width: cellW });
    });
    y += 34 * Math.ceil(stats.length / 6) + 14;

    // Earnings / deductions table
    const earnings = bd.lines.filter((l) => l.kind === "EARNING");
    const deductions = bd.lines.filter((l) => l.kind === "DEDUCTION");
    const half = W / 2 - 8;
    const table = (x: number, title: string, rows: BreakdownLine[], total: string) => {
      let ty = y;
      doc.rect(x, ty, half, 20).fill(BLUE);
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#fff").text(title, x + 8, ty + 6);
      doc.text(`Amount (${cur})`, x, ty + 6, { width: half - 8, align: "right" });
      ty += 24;
      for (const r of rows) {
        doc.font("Helvetica").fontSize(9).fillColor(INK).text(r.label + (r.quantity ? `  ×${r.quantity}` : ""), x + 8, ty, { width: half - 110 });
        doc.text(formatMoneyPlain(r.amount), x, ty, { width: half - 8, align: "right" });
        if (r.detail) { ty += 11; doc.fontSize(7.5).fillColor(MUTED).text(r.detail, x + 8, ty, { width: half - 110 }); }
        ty += 15;
      }
      if (!rows.length) { doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("None", x + 8, ty); ty += 15; }
      doc.moveTo(x, ty).lineTo(x + half, ty).strokeColor("#e2e8f0").stroke();
      ty += 5;
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text("Total", x + 8, ty);
      doc.text(formatMoneyPlain(total), x, ty, { width: half - 8, align: "right" });
      return ty + 20;
    };
    const grossTotal = p.grossPay.toString();
    const dedTotal = p.componentsDeducted.plus(p.deductionsTotal).plus(p.attendanceDeduction).plus(p.lateDeduction).toString();
    const y1 = table(48, "Earnings", earnings.filter((l) => l.key !== "base").concat([{ key: "base_earned", label: `Base salary earned (of ${money(salary.baseSalary)})`, kind: "EARNING", amount: p.baseEarned.toString() }]).sort((a) => (a.key === "base_earned" ? -1 : 0)), grossTotal);
    const y2 = table(48 + half + 16, "Deductions", deductions, dedTotal);
    y = Math.max(y1, y2) + 10;

    // Net pay
    doc.rect(48, y, W, 40).fill("#f1f5f9");
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text("NET PAY", 60, y + 13);
    doc.font("Helvetica-Bold").fontSize(15).fillColor(BLUE).text(money(p.netPay), 48, y + 11, { width: W - 12, align: "right" });
    y += 56;

    doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text("Rules applied", 48, y);
    y += 13;
    doc.font("Helvetica").fontSize(8).fillColor(MUTED);
    for (const r of bd.rulesApplied) { doc.text(`• ${r}`, 48, y, { width: W }); y += 11; }

    const footer = company.payslipFooter || "This is a system-generated payslip and does not require a signature.";
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(`${footer}\nGenerated ${formatInstant(p.generatedAt, company.timezone)}${p.run.finalizedAt ? ` · Finalized ${formatInstant(p.run.finalizedAt, company.timezone)}` : " · DRAFT — not final"}`, 48, doc.page.height - 80, { width: W, align: "center" });
    doc.end();
  });
}

function formatMoneyPlain(v: string) {
  return new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
}
