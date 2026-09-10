import { Prisma, type AuditAction, type UserRole } from "@prisma/client";
import type { Db } from "@/server/db";

const REDACT_KEYS = new Set(["passwordHash", "password", "nationalIdEncrypted", "bankAccountEncrypted", "tokenHash"]);

export function redact<T>(v: T): T {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(redact) as unknown as T;
  if (v instanceof Date) return v.toISOString() as unknown as T;
  if (Prisma.Decimal.isDecimal(v)) return (v as unknown as Prisma.Decimal).toString() as unknown as T;
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.has(k) ? "[redacted]" : redact(val);
    }
    return out as T;
  }
  if (typeof v === "bigint") return v.toString() as unknown as T;
  return v;
}

export interface AuditInput {
  actorUserId: string | null;
  actorRole?: UserRole | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

export async function audit(db: Db, input: AuditInput): Promise<void> {
  await db.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      actorRole: input.actorRole ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      beforeData: input.before === undefined ? undefined : (redact(input.before) as Prisma.InputJsonValue),
      afterData: input.after === undefined ? undefined : (redact(input.after) as Prisma.InputJsonValue),
      ipAddress: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}
