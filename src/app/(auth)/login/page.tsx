import Image from "next/image";
import type { Metadata } from "next";
import { loginAction } from "@/server/actions/auth";
import { ActionForm, Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div>
      <div className="mb-8 flex items-center gap-3 lg:hidden">
        <Image src="/brand/logo-dark.png" alt="Nexus-Tel" width={40} height={49} priority />
        <span className="font-display text-xl font-semibold text-slate-900">Nexus-Tel</span>
      </div>
      <h1 className="font-display text-2xl font-semibold text-slate-900">Sign in to the portal</h1>
      <p className="mt-1 text-sm text-slate-500">Use your company email and password.</p>
      <ActionForm action={loginAction} className="mt-8">
            <Field label="Email" htmlFor="email" name="email">
              <Input id="email" name="email" type="email" autoComplete="username" required autoFocus placeholder="you@nexus-tel.com" />
            </Field>
            <Field label="Password" htmlFor="password" name="password">
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </Field>
            <SubmitButton className="w-full" size="lg" pendingText="Signing in…">Sign in</SubmitButton>
            <p className="text-center text-xs text-slate-500">Forgot your password? Ask an administrator to issue a temporary one.</p>
      </ActionForm>
    </div>
  );
}
