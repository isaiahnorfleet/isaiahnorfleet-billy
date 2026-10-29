import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env, emailConfigured, pushConfigured } from "@/lib/env";
import { sql } from "@/lib/db/client";
import { runReminderCycle } from "@/lib/reminders/engine";
import { defaultSenders } from "@/lib/reminders/senders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = env().CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * The reminder scheduler. Called every 5 minutes by Supabase pg_cron (POST) and once a day by
 * Vercel Cron (GET) as a backup. Both send "Authorization: Bearer $CRON_SECRET".
 */
async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
