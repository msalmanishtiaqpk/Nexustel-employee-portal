import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export function PageHeader({ title, description, actions, breadcrumbs }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; breadcrumbs?: { label: string; href?: string }[] }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {breadcrumbs && (
          <nav className="mb-1 flex items-center gap-1 text-xs text-slate-500" aria-label="Breadcrumb">
            {breadcrumbs.map((b, i) => (
              <React.Fragment key={i}>
                {i > 0 && <ChevronRight className="h-3 w-3" aria-hidden />}
                {b.href ? <Link href={b.href} className="hover:text-brand-700">{b.label}</Link> : <span>{b.label}</span>}
              </React.Fragment>
            ))}
          </nav>
        )}
        <h1 className="font-display text-2xl font-semibold text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function DescriptionList({ items, cols = 2 }: { items: { label: string; value: React.ReactNode }[]; cols?: 1 | 2 | 3 }) {
  const colClass = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" }[cols];
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-4 ${colClass}`}>
      {items.map((it) => (
        <div key={it.label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{it.label}</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
