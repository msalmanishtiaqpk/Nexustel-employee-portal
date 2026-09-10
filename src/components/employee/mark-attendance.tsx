"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint } from "lucide-react";
import { markAttendanceAction } from "@/server/actions/attendance";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type { ActionState } from "@/server/actions/types";

export function MarkAttendanceButton({ label }: { label: string }) {
  const [state, action, pending] = useActionState<ActionState, void>(async () => markAttendanceAction(), null);
  const router = useRouter();
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);
  return (
    <div className="space-y-3">
      {state && !state.ok && <Alert variant="error">{state.error}</Alert>}
      {state?.ok && <Alert variant="success">{state.message}</Alert>}
      <form action={() => action()}>
        <Button type="submit" size="lg" loading={pending} className="w-full sm:w-auto">
          <Fingerprint className="h-5 w-5" /> {label}
        </Button>
      </form>
    </div>
  );
}

/** Reloads the page when the window opens/closes so the button state stays accurate. */
export function AutoRefresh({ at }: { at: string | null }) {
  const router = useRouter();
  useEffect(() => {
    if (!at) return;
    const ms = new Date(at).getTime() - Date.now() + 1000;
    if (ms <= 0 || ms > 6 * 3600_000) return;
    const t = setTimeout(() => router.refresh(), ms);
    return () => clearTimeout(t);
  }, [at, router]);
  return null;
}
