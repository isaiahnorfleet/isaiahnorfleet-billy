import { NextResponse } from "next/server";
import { getProfile, getSessionUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db/client";
import { minorToInput } from "@/lib/domain/money";

export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralize spreadsheet formula injection and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Download all of the signed-in user's data: JSON (everything) or CSV (payment history). */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const profile = await getProfile(user);
  const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "json";
  const data = await withUser(user.id, async (tx) => ({
    profile: (await tx`select display_name, currency, time_zone, tone, created_at from profiles`)[0],
    preferences: (await tx`select * from notification_preferences`)[0],
    bills: await tx`select * from bills order by created_at`,
    occurrences: await tx`select * from bill_occurrences order by due_date`,
    payments: await tx`select p.*, b.name as bill_name from payments p join bills b on b.id = p.bill_id order by paid_on`,
    devices: await tx`select device_label, created_at, last_success_at, disabled_at from push_subscriptions`,
  }));
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    const header = ["paid_on", "bill", "amount", "currency", "due_date_occurrence_id", "note", "voided_at", "void_reason"];
    const rows = (data.payments as unknown as Record<string, unknown>[]).map((p) =>
      [p.paid_on, p.bill_name, minorToInput(Number(p.amount_minor), String(p.currency)), p.currency, p.occurrence_id, p.note, p.voided_at, p.void_reason].map(csvCell).join(","),
    );
    return new NextResponse([header.join(","), ...rows].join("\n"), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="billy-payments-${stamp}.csv"`, "cache-control": "no-store" },
    });
  }
  return new NextResponse(JSON.stringify({ exported_at: new Date().toISOString(), email: profile.email, ...data }, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="billy-export-${stamp}.json"`, "cache-control": "no-store" },
  });
}
