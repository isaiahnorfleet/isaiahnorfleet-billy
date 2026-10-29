import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Local development / automated test sign-in. Disabled unless AUTH_MODE=dev and refused
 * outright in production (see env.ts). Cookies are HMAC-signed so they cannot be forged.
 */
export const DEV_COOKIE = "billy_dev_session";

function sign(payload: string): string {
  return createHmac("sha256", env().DEV_AUTH_SECRET!).update(payload).digest("base64url");
}

export function encodeDevSession(userId: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({ sub: userId, email })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeDevSession(value: string | undefined): { sub: string; email: string } | null {
  if (!value || env().AUTH_MODE !== "dev") return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof data.sub === "string" && typeof data.email === "string" ? data : null;
  } catch {
    return null;
  }
}
