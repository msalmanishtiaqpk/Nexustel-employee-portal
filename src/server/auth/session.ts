import "server-only";
import { cookies, headers } from "next/headers";
import { prisma } from "@/server/db";
import { config } from "@/server/config";
import { randomToken, sha256Hex } from "@/lib/crypto";
import type { Actor } from "@/server/auth/actor";

export type { Actor };

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0].trim() : h.get("x-real-ip")) || null;
  return { ip, userAgent: h.get("user-agent")?.slice(0, 500) ?? null };
}

export async function createSession(userId: string, meta: RequestMeta): Promise<void> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.sessionAbsoluteHours * 3600_000);
  await prisma.session.create({
    data: { userId, tokenHash: sha256Hex(token), ipAddress: meta.ip, userAgent: meta.userAgent, expiresAt },
  });
  const jar = await cookies();
  jar.set(config.cookieName, token, {
    httpOnly: true,
    secure: config.appUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(config.cookieName)?.value;
  if (token) {
    await prisma.session.updateMany({ where: { tokenHash: sha256Hex(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }
  jar.delete(config.cookieName);
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

/** Resolve the current actor from the session cookie. Returns null when not authenticated. */
export async function getActor(): Promise<Actor | null> {
  const jar = await cookies();
  const token = jar.get(config.cookieName)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: { select: { id: true, role: true, email: true, isActive: true, mustChangePassword: true, employee: { select: { id: true } } } } },
  });
  if (!session || session.revokedAt) return null;

  const now = Date.now();
  const idleLimit = session.lastSeenAt.getTime() + config.sessionIdleHours * 3600_000;
  if (session.expiresAt.getTime() < now || idleLimit < now || !session.user.isActive) {
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } }).catch(() => {});
    return null;
  }
  // Throttle lastSeen writes to once per 5 minutes.
  if (now - session.lastSeenAt.getTime() > 5 * 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return {
    userId: session.user.id,
    role: session.user.role,
    email: session.user.email,
    employeeId: session.user.employee?.id ?? null,
    mustChangePassword: session.user.mustChangePassword,
    sessionId: session.id,
  };
}
