import Image from "next/image";
import Link from "next/link";
import { LogOut, ShieldCheck } from "lucide-react";
import type { Actor } from "@/server/auth/actor";
import { logoutAction } from "@/server/actions/auth";
import { NavLinks, type NavItem } from "@/components/layout/nav-links";

export function AppShell({ actor, nav, title, children }: { actor: Actor; nav: NavItem[]; title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen lg:flex">
      <aside className="flex flex-col border-b border-slate-200 bg-ink text-slate-200 lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-5 py-4 lg:block">
          <Link href={actor.role === "ADMIN" ? "/admin" : "/"} className="flex items-center gap-3">
            <Image src="/brand/logo-light.png" alt="Nexus-Tel" width={34} height={42} priority />
            <div>
              <p className="font-display text-base font-semibold leading-tight text-white">Nexus-Tel</p>
              <p className="text-[11px] uppercase tracking-wider text-slate-400">{title}</p>
            </div>
          </Link>
          <form action={logoutAction} className="lg:hidden">
            <button className="rounded-md p-2 text-slate-300 hover:bg-white/10" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
          </form>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-visible lg:px-3 lg:py-2" aria-label="Main">
          <NavLinks items={nav} />
        </nav>
        <div className="hidden border-t border-white/10 px-5 py-4 lg:block">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            {actor.role === "ADMIN" && <ShieldCheck className="h-3.5 w-3.5 text-gold-500" aria-hidden />}
            <span className="truncate" title={actor.email}>{actor.email}</span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            {actor.role === "ADMIN" && actor.employeeId ? (
              <Link href="/" className="text-xs text-slate-300 hover:text-white">My portal</Link>
            ) : actor.role === "ADMIN" ? <span /> : <Link href="/change-password" className="text-xs text-slate-300 hover:text-white">Change password</Link>}
            <form action={logoutAction}>
              <button className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10 hover:text-white"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
            </form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
