import { hash, verify } from "@node-rs/argon2";

const ARGON_OPTS = { memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON_OPTS);
}

export async function verifyPassword(hashStr: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashStr, plain);
  } catch {
    return false;
  }
}

const COMMON = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123", "qwertyuiop",
  "iloveyou", "admin123", "welcome1", "letmein1", "abc12345", "nexustel", "nexus-tel", "changeme", "changeme1",
]);

export function passwordPolicyErrors(pw: string, email?: string): string[] {
  const errs: string[] = [];
  if (pw.length < 10) errs.push("Must be at least 10 characters");
  if (pw.length > 128) errs.push("Must be at most 128 characters");
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) errs.push("Must include upper and lower case letters");
  if (!/\d/.test(pw)) errs.push("Must include a number");
  if (COMMON.has(pw.toLowerCase())) errs.push("Password is too common");
  if (email && pw.toLowerCase().includes(email.split("@")[0].toLowerCase())) errs.push("Must not contain your email");
  return errs;
}
