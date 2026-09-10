"use client";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="font-display text-2xl font-semibold text-slate-900">Something went wrong</p>
      <p className="text-slate-600">The error has been logged. Please try again.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
