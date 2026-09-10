import type { BreakdownLine } from "@/server/services/payroll/engine";
import { formatMoney } from "@/lib/money";

export function PayslipBreakdown({ lines, rulesApplied, currency, gross, net }: { lines: BreakdownLine[]; rulesApplied: string[]; currency: string; gross: string; net: string }) {
  const earnings = lines.filter((l) => l.kind === "EARNING");
  const deductions = lines.filter((l) => l.kind === "DEDUCTION");
  const info = lines.filter((l) => l.kind === "INFO");
  const col = (title: string, rows: BreakdownLine[]) => (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      {rows.length === 0 ? <p className="text-sm text-slate-400">None</p> : (
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((l, i) => (
            <li key={`${l.key}-${i}`} className="flex items-start justify-between gap-3 py-1.5">
              <div>
                <p className="text-slate-800">{l.label}{l.quantity ? <span className="text-slate-500"> × {l.quantity}</span> : null}</p>
                {(l.detail || l.rate) && <p className="text-xs text-slate-500">{[l.rate, l.detail].filter(Boolean).join(" · ")}</p>}
              </div>
              <span className="tabular-nums text-slate-900">{formatMoney(l.amount, currency, 2)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <div className="space-y-6">
      {info.map((l) => <p key={l.key} className="text-sm text-slate-600">{l.label}: <strong>{formatMoney(l.amount, currency, 2)}</strong>{l.detail ? ` (${l.detail})` : ""}</p>)}
      <div className="grid gap-6 md:grid-cols-2">{col("Earnings", earnings)}{col("Deductions", deductions)}</div>
      <div className="grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
        <div><p className="text-xs uppercase tracking-wide text-slate-500">Gross pay</p><p className="font-display text-xl font-semibold text-slate-900">{formatMoney(gross, currency, 2)}</p></div>
        <div><p className="text-xs uppercase tracking-wide text-slate-500">Net pay</p><p className="font-display text-xl font-semibold text-brand-700">{formatMoney(net, currency, 2)}</p></div>
      </div>
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Rules applied</h4>
        <ul className="list-inside list-disc text-xs text-slate-600">{rulesApplied.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </div>
    </div>
  );
}
