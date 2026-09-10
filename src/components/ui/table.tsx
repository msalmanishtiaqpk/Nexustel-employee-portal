import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}
export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</thead>;
}
export function TH({ className, children, right }: { className?: string; children?: React.ReactNode; right?: boolean }) {
  return <th className={cn("px-4 py-2.5 font-semibold", right && "text-right", className)}>{children}</th>;
}
export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-slate-100">{children}</tbody>;
}
export function TR({ className, children }: { className?: string; children: React.ReactNode }) {
  return <tr className={cn("hover:bg-slate-50/70", className)}>{children}</tr>;
}
export function TD({ className, children, right, mono, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement> & { right?: boolean; mono?: boolean }) {
  return <td className={cn("px-4 py-2.5 align-middle text-slate-700", right && "text-right", mono && "tabular-nums", className)} {...rest}>{children}</td>;
}

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
      <span>
        Showing {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}
      </span>
      <div className="flex gap-2">
        {page > 1 && <Link className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50" href={hrefFor(page - 1)}>Previous</Link>}
        {page < pages && <Link className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50" href={hrefFor(page + 1)}>Next</Link>}
      </div>
    </div>
  );
}
