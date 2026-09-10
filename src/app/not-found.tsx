import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="font-display text-5xl font-semibold text-slate-900">404</p>
      <p className="text-slate-600">The page you are looking for doesn&apos;t exist or you don&apos;t have access to it.</p>
      <Link href="/" className="text-brand-700 hover:underline">Go to the dashboard</Link>
    </div>
  );
}
