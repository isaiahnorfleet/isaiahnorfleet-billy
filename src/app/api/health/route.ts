import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/** Liveness plus scheduler heartbeat. Exposes no user data. */
export async function GET() {
  try {
    const [last] = await sql()<{ started_at: Date; ok: boolean | null }[]>`
      select started_at, ok from job_runs where job = 'reminders' order by started_at desc limit 1`;
    const ageMin = last ? Math.round((Date.now() - last.started_at.getTime()) / 60000) : null;
    return NextResponse.json({ ok: true, scheduler: { lastRunMinutesAgo: ageMin, lastRunOk: last?.ok ?? null, healthy: ageMin !== null && ageMin <= 15 } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
