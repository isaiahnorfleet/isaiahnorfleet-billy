import "server-only";
import { withService } from "@/lib/db/client";

/** Fixed-window rate limit stored in Postgres (works across serverless instances). */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const [row] = await withService(
    (tx) => tx<{ count: number }[]>`
      insert into rate_limits (key, window_start, count) values (${key}, ${windowStart}, 1)
      on conflict (key, window_start) do update set count = rate_limits.count + 1
      returning count`,
  );
  if (Math.random() < 0.02) {
    await withService((tx) => tx`delete from rate_limits where window_start < now() - interval '2 days'`);
  }
  return row.count <= limit;
}
