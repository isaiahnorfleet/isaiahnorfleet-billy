import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env, emailConfigured, pushConfigured } from "@/lib/env";
import { sql } from "@/lib/db/client";
import { runReminderCycle } from "@/lib/reminders/engine";
import { defaultSenders } from "@/lib/reminders/senders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function matches(header: string, secret: string | null | undefined): boolean {
  if (!secret || secret.length < 16) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Token pg_cron sends. It is generated inside the database (private.scheduler_settings) and never
 * leaves it except in these requests, so nobody has to copy a secret between services.
 * Missing locally, where the scheduler migration isn't applied.
 */
async function databaseToken(): Promise<string | null> {
  try {
    const [row] = await sql()<{ cron_token: string }[]>`select cron_token from private.scheduler_settings where id = 1`;
    return row?.cron_token ?? null;
  } catch {
    return null;
  }
}

async function authorized(req: NextRequest): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  return matches(header, env().CRON_SECRET) || matches(header, await databaseToken());
}

/**
 * The reminder scheduler. Called every 5 minutes by Supabase pg_cron (POST, with the database's
 * own token) and once a day by Vercel Cron (GET, with CRON_SECRET) as a backup.
 */
async function handle(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = sql();
  const [run] = await db<{ id: number }[]>`insert into job_runs (job) values ('reminders') returning id`;
  try {
    const summary = await runReminderCycle({ sql: db, senders: defaultSenders(), appUrl: env().APP_URL, pushReady: pushConfigured(), emailReady: emailConfigured() });
    await db`update job_runs set finished_at = now(), ok = true, summary = ${db.json(JSON.parse(JSON.stringify(summary)))} where id = ${run.id}`;
    await db`delete from job_runs where started_at < now() - interval '14 days'`;
    console.log("reminder cycle", JSON.stringify(summary));
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    const message = (err as Error).message?.slice(0, 300) ?? "error";
    await db`update job_runs set finished_at = now(), ok = false, summary = ${db.json({ error: message })} where id = ${run.id}`;
    console.error("reminder cycle failed", message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
