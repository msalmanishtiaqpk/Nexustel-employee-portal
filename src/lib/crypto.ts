import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

function key(): Buffer {
  const hex = process.env.FIELD_ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("FIELD_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). Generate with: openssl rand -hex 32");
  }
  return Buffer.from(hex, "hex");
}

/** AES-256-GCM. Output format: v1.<iv b64url>.<ciphertext b64url>.<tag b64url> */
export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), ct.toString("base64url"), tag.toString("base64url")].join(".");
}

export function decryptField(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const [v, ivB, ctB, tagB] = payload.split(".");
  if (v !== "v1" || !ivB || !ctB || !tagB) throw new Error("Malformed encrypted field");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
}

export function last4(s: string | null | undefined): string | null {
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  return (digits || s).slice(-4);
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Random, readable temporary password: 16 chars from an unambiguous alphabet + required classes. */
export function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const symbols = "!@#$%&*";
  const pick = (set: string) => set[randomBytes(1)[0] % set.length];
  let out = "";
  for (let i = 0; i < 13; i++) out += pick(alphabet);
  out += pick("ABCDEFGHJKLMNPQRSTUVWXYZ") + pick("23456789") + pick(symbols);
  return out;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
