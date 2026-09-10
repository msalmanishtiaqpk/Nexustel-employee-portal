import "server-only";
import { z } from "zod";
import { AppError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import type { ActionState } from "@/server/actions/types";
import { isYmd } from "@/lib/dates";

export type { ActionState };

/** Wrap a server-action body: maps thrown AppErrors to ActionState, hides internals. */
export async function act(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    const res = await fn();
    return res ?? { ok: true };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    if (e instanceof AppError) return { ok: false, error: e.message };
    // Next.js redirect() throws a special error that must propagate.
    if (e instanceof Error && (e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    logger.error({ err: e }, "Unhandled server action error");
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Parse a FormData against a zod schema, converting issues into ValidationError. */
export function parse<T extends z.ZodTypeAny>(schema: T, fd: FormData): z.infer<T> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (k.endsWith("[]")) {
      const key = k.slice(0, -2);
      if (Array.isArray(obj[key])) (obj[key] as unknown[]).push(v);
      else obj[key] = [v];
    } else obj[k] = v;
  }
  const r = schema.safeParse(obj);
  if (!r.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of r.error.issues) {
      const k = i.path.join(".") || "_";
      (fieldErrors[k] ??= []).push(i.message);
    }
    const first = r.error.issues[0];
    throw new ValidationError(first ? `${first.path.join(".") || "Input"}: ${first.message}` : "Invalid input", fieldErrors);
  }
  return r.data;
}

// ── Reusable zod pieces ─────────────────────────────────────────────────────
export const zYmd = z.string().refine(isYmd, "Must be a date (YYYY-MM-DD)");
export const zOptYmd = z.preprocess((v) => (v === "" ? null : v), zYmd.nullable().optional());
export const zOptStr = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(2000).nullable().optional());
export const zStr = z.string().trim().min(1, "Required").max(500);
export const zMoney = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount");
export const zInt = z.coerce.number().int();
export const zBool = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
export const zUuid = z.string().uuid();
export const zOptUuid = z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable().optional());
export const zEmail = z.string().trim().toLowerCase().email("Enter a valid email");
