import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthLabel, previousMonth } from "@/lib/dates";

export function MonthPicker({ year, month, basePath, maxYear, maxMonth }: { year: number; month: number; basePath: string; maxYear: number; maxMonth: number }) {
  const prev = previousMonth(year, month);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const canNext = next.year < maxYear || (next.year === maxYear && next.month <= maxMonth);
  const sep = basePath.includes("?") ? (basePath.endsWith("&") || basePath.endsWith("?") ? "" : "&") : "?";
  const href = (y: number, m: number) => `${basePath}${sep}year=${y}&month=${m}`;
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-1 text-sm">
      <Link href={href(prev.year, prev.month)} className="rounded-md p-1.5 hover:bg-slate-100" aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Link>
      <span className="min-w-[9rem] text-center font-medium">{monthLabel(year, month)}</span>
      {canNext ? <Link href={href(next.year, next.month)} className="rounded-md p-1.5 hover:bg-slate-100" aria-label="Next month"><ChevronRight className="h-4 w-4" /></Link> : <span className="p-1.5 text-slate-300"><ChevronRight className="h-4 w-4" /></span>}
    </div>
  );
}

export function parseYearMonth(sp: { year?: string; month?: string }, fallback: { year: number; month: number }) {
  const y = Number(sp.year), m = Number(sp.month);
  if (Number.isInteger(y) && Number.isInteger(m) && m >= 1 && m <= 12 && y >= 2000 && y <= 2100) return { year: y, month: m };
  return fallback;
}
