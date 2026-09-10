"use client";
import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import type { ActionState } from "@/server/actions/types";

type ServerAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

const FormStateContext = React.createContext<ActionState>(null);
export const useFormState = () => React.useContext(FormStateContext);

interface ActionFormProps extends Omit<React.FormHTMLAttributes<HTMLFormElement>, "action"> {
  action: ServerAction;
  successMessage?: string;
  /** Navigate here after a successful submit. `{key}` placeholders are filled from state.data. */
  redirectTo?: string;
  resetOnSuccess?: boolean;
  /** Hide the inline success alert (e.g. for tiny inline forms). */
  quiet?: boolean;
  /** Ask for confirmation before submitting. */
  confirm?: string;
}

export function ActionForm({ action, children, successMessage, redirectTo, resetOnSuccess, quiet, confirm, className, ...props }: ActionFormProps) {
  const [state, formAction] = useActionState(action, null);
  const router = useRouter();
  const ref = React.useRef<HTMLFormElement>(null);
  const handled = React.useRef<ActionState>(null);

  React.useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;
    if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      if (redirectTo) {
        const target = redirectTo.replace(/\{(\w+)\}/g, (_, k) => String(state.data?.[k] ?? ""));
        router.push(target);
      } else router.refresh();
    }
  }, [state, redirectTo, resetOnSuccess, router]);

  return (
    <FormStateContext.Provider value={state}>
      <form
        ref={ref}
        action={formAction}
        className={cn("space-y-4", className)}
        onSubmit={confirm ? (e) => { if (!window.confirm(confirm)) e.preventDefault(); } : undefined}
        {...props}
      >
        {state && !state.ok && state.error && <Alert variant="error">{state.error}</Alert>}
        {!quiet && state?.ok && (state.message || successMessage) && <Alert variant="success">{state.message ?? successMessage}</Alert>}
        {children}
      </form>
    </FormStateContext.Provider>
  );
}

export function FieldError({ name }: { name: string }) {
  const state = useFormState();
  const errors = state?.fieldErrors?.[name];
  if (!errors?.length) return null;
  return <p className="mt-1 text-xs text-rose-600">{errors.join(". ")}</p>;
}

export function Field({ label, name, htmlFor, hint, children, className }: { label: React.ReactNode; name: string; htmlFor?: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  const state = useFormState();
  const hasError = Boolean(state?.fieldErrors?.[name]?.length);
  return (
    <div className={className}>
      <label htmlFor={htmlFor ?? name} className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      {children}
      {hint && !hasError && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      <FieldError name={name} />
    </div>
  );
}

/** Renders `state.data[key]` after a successful submit (e.g. a generated temporary password). */
export function ResultValue({ dataKey, label }: { dataKey: string; label: string }) {
  const state = useFormState();
  const v = state?.ok ? state.data?.[dataKey] : undefined;
  if (v === undefined || v === null) return null;
  return (
    <div className="rounded-lg border border-gold-500/40 bg-gold-100 p-3 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gold-600">{label}</p>
      <code className="mt-1 block select-all font-mono text-base text-slate-900">{String(v)}</code>
    </div>
  );
}

/** Renders a link once the action succeeded; `{key}` placeholders are filled from state.data. */
export function ResultLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  const state = useFormState();
  if (!state?.ok) return null;
  const target = href.replace(/\{(\w+)\}/g, (_, k) => String(state.data?.[k] ?? ""));
  return <a href={target} className={cn("inline-flex h-10 items-center rounded-lg bg-slate-800 px-4 text-sm font-medium text-white hover:bg-slate-900", className)}>{children}</a>;
}
