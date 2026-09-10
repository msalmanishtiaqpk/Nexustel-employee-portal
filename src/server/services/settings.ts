import { cache } from "react";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/auth/actor";
import { audit } from "@/server/services/audit";
import { DEFAULT_TZ } from "@/lib/dates";

export const getSettings = cache(async () => {
  const s = await prisma.companySettings.findUnique({ where: { id: 1 } });
  if (s) return s;
  return prisma.companySettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
});

export async function companyTimezone(): Promise<string> {
  return (await getSettings()).timezone || DEFAULT_TZ;
}

export interface SettingsUpdate {
  companyName: string;
  timezone: string;
  currency: string;
  defaultScheduleId: string | null;
  attendanceIpAllowlist: string[];
  payslipFooter: string | null;
}

export async function updateSettings(actor: Actor, data: SettingsUpdate, meta?: { ip?: string | null }) {
  const before = await getSettings();
  const after = await prisma.companySettings.update({ where: { id: 1 }, data: { ...data, updatedById: actor.userId } });
  await audit(prisma, { actorUserId: actor.userId, actorRole: actor.role, action: "UPDATE", entityType: "CompanySettings", entityId: "1", before, after, ip: meta?.ip });
  return after;
}

/** Validate a CIDR / IP string. */
export function isCidr(s: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(s.trim());
  if (!m) return /^[0-9a-fA-F:]+(\/\d{1,3})?$/.test(s.trim()); // permissive IPv6
  const octets = m.slice(1, 5).map(Number);
  const bits = m[5] === undefined ? 32 : Number(m[5]);
  return octets.every((o) => o <= 255) && bits <= 32;
}

export function ipInAllowlist(ip: string | null, allowlist: string[]): boolean {
  if (!allowlist.length) return true;
  if (!ip) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!v4) return allowlist.some((c) => c.split("/")[0] === ip);
  const ipNum = v4.slice(1).reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
  return allowlist.some((c) => {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(c.trim());
    if (!m) return false;
    const net = m.slice(1, 5).reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
    const bits = m[5] === undefined ? 32 : Number(m[5]);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipNum & mask) === (net & mask);
  });
}
