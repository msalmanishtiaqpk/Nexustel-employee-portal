"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { act, parse, zEmail } from "@/server/actions/util";
import type { ActionState } from "@/server/actions/types";
import { login, logout, changePassword } from "@/server/services/auth";
import { getActor, requestMeta } from "@/server/auth/session";
import { requireUser } from "@/server/rbac";

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let dest: string | null = null;
  const res = await act(async () => {
    const { email, password } = parse(z.object({ email: zEmail, password: z.string().min(1, "Required") }), fd);
    const r = await login(email, password, await requestMeta());
    dest = r.mustChangePassword ? "/change-password" : r.role === "ADMIN" ? "/admin" : "/";
  });
  if (dest) redirect(dest);
  return res;
}

export async function logoutAction(): Promise<void> {
  const actor = await getActor();
  await logout(actor, await requestMeta());
  redirect("/login");
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let dest: string | null = null;
  const res = await act(async () => {
    const actor = await requireUser();
    const d = parse(z.object({ currentPassword: z.string().min(1, "Required"), newPassword: z.string().min(1, "Required"), confirmPassword: z.string().min(1, "Required") }), fd);
    if (d.newPassword !== d.confirmPassword) return { ok: false, error: "Passwords do not match", fieldErrors: { confirmPassword: ["Passwords do not match"] } };
    await changePassword(actor, d.currentPassword, d.newPassword, await requestMeta());
    if (actor.mustChangePassword) dest = actor.role === "ADMIN" ? "/admin" : "/";
    return { ok: true, message: "Password updated. Other sessions have been signed out." };
  });
  if (dest) redirect(dest);
  return res;
}
