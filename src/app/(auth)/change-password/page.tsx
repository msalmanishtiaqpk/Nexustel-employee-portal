import type { Metadata } from "next";
import { requireUserPage } from "@/server/rbac";
import { changePasswordAction, logoutAction } from "@/server/actions/auth";
import { ActionForm, Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button, SubmitButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import Link from "next/link";

export const metadata: Metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const actor = await requireUserPage();
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-slate-900">{actor.mustChangePassword ? "Set a new password" : "Change password"}</h1>
      <p className="mt-1 text-sm text-slate-500">Signed in as {actor.email}</p>
      {actor.mustChangePassword && (
        <Alert variant="warning" className="mt-4">You are using a temporary password. Choose a new one to continue.</Alert>
      )}
      <ActionForm action={changePasswordAction} className="mt-6">
            <Field label="Current (temporary) password" htmlFor="currentPassword" name="currentPassword">
              <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
            </Field>
            <Field label="New password" htmlFor="newPassword" hint="At least 10 characters with upper, lower case and a number." name="newPassword">
              <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={10} />
            </Field>
            <Field label="Confirm new password" htmlFor="confirmPassword" name="confirmPassword">
              <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
            </Field>
            <div className="flex justify-end">
              <SubmitButton pendingText="Saving…">Update password</SubmitButton>
            </div>
      </ActionForm>
      <div className="mt-4">
        {actor.mustChangePassword ? (
          <form action={logoutAction}><Button type="submit" variant="ghost" size="sm">Sign out</Button></form>
        ) : (
          <Link href={actor.role === "ADMIN" ? "/admin" : "/"} className="text-sm text-slate-600 hover:text-brand-700">← Back</Link>
        )}
      </div>
    </div>
  );
}
