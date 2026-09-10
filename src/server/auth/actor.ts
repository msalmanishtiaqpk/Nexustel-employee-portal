import type { UserRole } from "@prisma/client";
import { ForbiddenError } from "@/server/errors";

export interface Actor {
  userId: string;
  role: UserRole;
  email: string;
  employeeId: string | null;
  mustChangePassword: boolean;
  sessionId: string;
}

export function assertAdmin(actor: Actor): void {
  if (actor.role !== "ADMIN") throw new ForbiddenError();
}

/** Employee-scoped services call this so they only ever operate on the actor's own record. */
export function ownEmployeeId(actor: Actor): string {
  if (!actor.employeeId) throw new ForbiddenError("This account has no employee profile");
  return actor.employeeId;
}
