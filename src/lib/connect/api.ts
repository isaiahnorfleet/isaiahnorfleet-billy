import "server-only";
import { verifyConnectRequest } from "./signing";

/**
 * Norfleet Connect v1 provider (Norfleet One Release 11D). Norfleet One reads Billy's business obligations with signed
 * GETs; see supabase/migrations/20261127000001_norfleet_one_connect.sql and docs/NORFLEET-ONE-BRIDGE.md.
 * Any failed check answers a plain 401: which check failed is never told to the caller.
 */
export interface ConnectDb {
  secretFor(keyId: string): Promise<string | null>;
  /** 'ok' | 'unknown' | 'replay' | 'rate_limited' */
  use(keyId: string, nonce: string): Promise<string>;
  health(keyId: string): Promise<Record<string, unknown> | null>;
  obligations(keyId: string, after: string | null, limit: number, from: string, to: string): Promise<Record<string, unknown> | null>;
}

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURSOR = /^occ_[a-f0-9]{32}$/;

function reply(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex", ...extra },
  });
}
const unauthorized = () => reply({ error: { code: "unauthorized", message: "Unauthorized" } }, 401);

export async function handleConnect(req: Request, resource: "health" | "obligations", db: ConnectDb, nowMs = Date.now()): Promise<Response> {
  if (req.method !== "GET") return reply({ error: { code: "method_not_allowed", message: "GET only" } }, 405, { allow: "GET" });
  // Checked before the database is touched, so the nonce check runs only for a valid signature.
  const v = await verifyConnectRequest({
    method: "GET", url: req.url, body: "", headers: req.headers,
    secretFor: (id) => db.secretFor(id),
    seenNonce: async () => false,
    nowSec: Math.floor(nowMs / 1000),
  });
  if (!v.ok) return unauthorized();
  const nonce = req.headers.get("x-norfleet-nonce") || "";
  const used = await db.use(v.keyId, nonce);
  if (used === "rate_limited") return reply({ error: { code: "rate_limited", message: "Too many requests" } }, 429, { "retry-after": "60" });
  if (used !== "ok") return unauthorized();

  if (resource === "health") {
    const h = await db.health(v.keyId);
    return h ? reply(h) : unauthorized();
  }

  const q = new URL(req.url).searchParams;
  const cursor = q.get("cursor") || null;
  const from = q.get("from") || isoDay(nowMs - 400 * DAY);
  const to = q.get("to") || isoDay(nowMs + 400 * DAY);
  const limit = Number(q.get("limit") || 200);
  if ((cursor && !CURSOR.test(cursor)) || !DATE.test(from) || !DATE.test(to) || to < from || !Number.isInteger(limit) || limit < 1 || limit > 500) {
    return reply({ error: { code: "bad_request", message: "Check cursor, from, to and limit" } }, 400);
  }
  const page = await db.obligations(v.keyId, cursor, limit, from, to);
  if (!page) return reply({ error: { code: "forbidden", message: "This key can't read obligations" } }, 403);
  return reply({
    contract: "billy.obligations",
    version: "1.0.0",
    provider: { app: "billy", build: (process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 12) },
    generated_at: new Date(nowMs).toISOString(),
    page: { cursor, next_cursor: page.next_cursor ?? null, limit: page.limit ?? limit },
    data: page.data ?? [],
    completeness: page.completeness ?? { status: "unknown", notes: [] },
  });
}
