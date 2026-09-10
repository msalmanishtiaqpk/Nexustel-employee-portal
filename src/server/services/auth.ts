import { prisma } from "@/server/db";
import { config } from "@/server/config";
import { hashPassword, passwordPolicyErrors, verifyPassword } from "@/server/auth/password";
import { rateLimit } from "@/server/auth/rate-limit";
import { createSession, destroyCurrentSession, revokeAllSessions, type Actor, type RequestMeta } from "@/server/auth/session";
import { audit } from "@/server/services/audit";
import { AppError, ValidationError } from "@/server/errors";

const GENERIC = "Invalid email or password";

export async function login(emailRaw: string, password: string, meta: RequestMeta): Promise<{ role: "ADMIN" | "EMPLOYEE"; mustChangePassword: boolean }> {
  const email = emailRaw.trim().toLowerCase();
  const ipKey = `login:ip:${meta.ip ?? "unknown"}`;
  const rl = rateLimit(ipKey, config.login.ipLimitPerMinute, 60_000);
  if (!rl.ok) throw new AppError(`Too many attempts. Try again in ${rl.retryAfterSec}s.`, "RATE_LIMITED", 429);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await verifyPassword("$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", password); // constant-time-ish
    await audit(prisma, { actorUserId: null, action: "LOGIN_FAILED", entityType: "User", entityId: email, ip: meta.ip, userAgent: meta.userAgent });
    throw new AppError(GENERIC, "BAD_CREDENTIALS", 401);
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new AppError(`Account locked. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, "LOCKED", 423);
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok || !user.isActive) {
    const failures = user.failedLoginAttempts + 1;
    const lock = failures >= config.login.maxFailures;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: lock ? 0 : failures, lockedUntil: lock ? new Date(Date.now() + config.login.lockMinutes * 60_000) : null },
    });
    await audit(prisma, { actorUserId: user.id, actorRole: user.role, action: "LOGIN_FAILED", entityType: "User", entityId: user.id, ip: meta.ip, userAgent: meta.userAgent, after: { inactive: !user.isActive, locked: lock } });
    if (!user.isActive) throw new AppError("This account is deactivated. Contact your administrator.", "INACTIVE", 403);
    throw new AppError(lock ? `Too many failed attempts. Account locked for ${config.login.lockMinutes} minutes.` : GENERIC, "BAD_CREDENTIALS", 401);
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await createSession(user.id, meta);
  await audit(prisma, { actorUserId: user.id, actorRole: user.role, action: "LOGIN", entityType: "User", entityId: user.id, ip: meta.ip, userAgent: meta.userAgent });
  return { role: user.role, mustChangePassword: user.mustChangePassword };
}

export async function logout(actor: Actor | null, meta: RequestMeta): Promise<void> {
  await destroyCurrentSession();
  if (actor) await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: "LOGOUT", entityType: "User", entityId: actor.userId, ip: meta.ip });
}

export async function changePassword(actor: Actor, currentPassword: string, newPassword: string, meta: RequestMeta): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new ValidationError("Current password is incorrect", { currentPassword: ["Current password is incorrect"] });
  }
  const errs = passwordPolicyErrors(newPassword, user.email);
  if (errs.length) throw new ValidationError("Password does not meet the policy", { newPassword: errs });
  if (await verifyPassword(user.passwordHash, newPassword)) throw new ValidationError("New password must differ from the current one", { newPassword: ["Must differ from the current password"] });
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false, passwordChangedAt: new Date() },
  });
  await revokeAllSessions(user.id, actor.sessionId);
  await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: "PASSWORD_CHANGE", entityType: "User", entityId: user.id, ip: meta.ip });
}
