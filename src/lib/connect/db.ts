import "server-only";
import { sql } from "@/lib/db/client";
import type { ConnectDb } from "./api";

/** The four connect.api_* functions, run by the app's database login (no user session). */
export const connectDb: ConnectDb = {
  async secretFor(keyId) {
    const [r] = await sql()<{ s: string | null }[]>`select connect.api_key(${keyId}) as s`;
    return r?.s ?? null;
  },
  async use(keyId, nonce) {
    const [r] = await sql()<{ s: string }[]>`select connect.api_use(${keyId}, ${nonce}) as s`;
    return r?.s ?? "unknown";
  },
  async health(keyId) {
    const [r] = await sql()<{ j: Record<string, unknown> | null }[]>`select connect.api_health(${keyId}) as j`;
    return r?.j ?? null;
  },
  async obligations(keyId, after, limit, from, to) {
    const [r] = await sql()<{ j: Record<string, unknown> | null }[]>`
      select connect.api_obligations(${keyId}, ${after}, ${limit}, ${from}::date, ${to}::date) as j`;
    return r?.j ?? null;
  },
};
