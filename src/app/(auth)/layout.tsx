import Image from "next/image";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-ink p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <Image src="/brand/logo-light.png" alt="Nexus-Tel" width={44} height={54} priority />
          <span className="font-display text-xl font-semibold">Nexus-Tel</span>
        </div>
        <div>
          <p className="font-display text-4xl font-semibold leading-tight">
            We don&apos;t just make calls.<br />
            <span className="text-gold-500">We build sales teams</span> that generate revenue.
          </p>
          <p className="mt-6 max-w-md text-slate-300">Employee portal for attendance, leave and payroll.</p>
        </div>
        <p className="text-xs text-slate-400">© {new Date().getFullYear()} Nexus-Tel · Lahore, Pakistan</p>
        <Image src="/brand/logo-light.png" alt="" width={420} height={516} className="pointer-events-none absolute -bottom-24 -right-16 opacity-[0.06]" aria-hidden />
      </div>
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
