import "server-only";
import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/session";
import { ForbiddenError, UnauthorizedError } from "@/server/errors";
import { assertAdmin, ownEmployeeId, type Actor } from "@/server/auth/actor";

export { assertAdmin, ownEmployeeId };
export type { Actor };

/** For page components: redirects to login when unauthenticated. */
export async function requireUserPage(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return actor;
}

export async function requireAdminPage(): Promise<Actor> {
  const actor = await requireUserPage();
  if (actor.mustChangePassword) redirect("/change-password");
  if (actor.role !== "ADMIN") redirect("/");
  return actor;
}

export async function requireEmployeePage(): Promise<Actor & { employeeId: string }> {
  const actor = await requireUserPage();
  if (actor.mustChangePassword) redirect("/change-password");
  if (!actor.employeeId) redirect("/admin");
  return actor as Actor & { employeeId: string };
}

/** For server actions / route handlers: throws instead of redirecting. */
export async function requireUser(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new UnauthorizedError();
  return actor;
}

export async function requireAdmin(): Promise<Actor> {
  const actor = await requireUser();
  if (actor.mustChangePassword) throw new ForbiddenError("Please change your password first");
  if (actor.role !== "ADMIN") throw new ForbiddenError();
  return actor;
}

export async function requireEmployee(): Promise<Actor & { employeeId: string }> {
  const actor = await requireUser();
  if (actor.mustChangePassword) throw new ForbiddenError("Please change your password first");
  if (!actor.employeeId) throw new ForbiddenError("This account has no employee profile");
  return actor as Actor & { employeeId: string };
}


