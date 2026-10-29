import "server-only";
import postgres from "postgres";
import { env } from "@/lib/env";

export type Sql = postgres.Sql<Record<string, unknown>>;
export type Tx = postgres.TransactionSql<Record<string, unknown>>;

const globalForDb = globalThis as unknown as { __billySql?: Sql };

function createClient(): Sql {
  const url = env().DATABASE_URL;
  // Supabase's transaction pooler (port 6543) does not support prepared statements.
  const pooled = /:6543\//.test(url);
  return postgres(url, {
    max: pooled ? 3 : 5,
    prepare: !pooled,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    types: {
      // Dates stay as 'YYYY-MM-DD' strings so they are never shifted by a UTC conversion.
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
      // Money columns are bigint minor units. Values are bounded well below 2^53.
      int8: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
    },
  }) as unknown as Sql;
}

export function sql(): Sql {
  if (!globalForDb.__billySql) globalForDb.__billySql = createClient();
  return globalForDb.__billySql;
}

/**
 * Run queries as an end user. Row-level security is enforced by Postgres: the transaction
 * switches to the `authenticated` role and sets the JWT `sub` claim that auth.uid() reads.
 * Application code cannot read or change another user's rows even if it has a bug.
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid user id");
  return (await sql().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  })) as T;
}

/** Privileged access for the scheduler and account lifecycle. Bypasses RLS: use sparingly. */
export async function withService<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql().begin(async (tx) => fn(tx))) as T;
}
