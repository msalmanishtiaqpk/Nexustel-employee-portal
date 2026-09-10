"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import * as Icons from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof Icons;
  exact?: boolean;
}

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((it) => {
        const Icon = Icons[it.icon] as React.ComponentType<{ className?: string }>;
        const active = it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(`${it.href}/`);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cn("flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition", active ? "bg-brand-600 text-white shadow-sm" : "text-slate-300 hover:bg-white/10 hover:text-white")}
          >
            <Icon className="h-4 w-4" />
            <span>{it.label}</span>
          </Link>
        );
      })}
    </>
  );
}
