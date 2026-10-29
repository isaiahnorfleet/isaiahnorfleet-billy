import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, Download } from "lucide-react";
import { withService, withUser } from "@/lib/db/client";
import { getPreferences, listPendingReminders, listPushSubscriptions, listRecentDeliveries } from "@/lib/data/notifications";
import { emailConfigured, env, pushConfigured } from "@/lib/env";
import { pageContext } from "@/lib/server/context";
import { timeZoneOptions } from "@/lib/timezones";
import { PushSetup } from "@/components/app/PushSetup";
import { DeleteAccount, PreferencesForm, ProfileForm, RemoveDeviceButton, TestButtons } from "@/components/app/SettingsForms";
import { SignOutButton } from "@/components/app/SignOutButton";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Settings" };

function fmt(d: Date | null, tz: string) {
  return d ? d.toLocaleString("en-CA", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";
}

const KIND: Record<string, string> = { before: "Heads-up", due: "Due today", overdue: "Overdue follow-up", snooze: "Snoozed reminder", test: "Test" };

export default async function SettingsPage() {
  const ctx = await pageContext();
  const tz = ctx.profile.time_zone;
  const { prefs, devices, deliveries, pending } = await withUser(ctx.user.id, async (tx) => ({
    prefs: await getPreferences(tx, ctx.user.id),
    devices: await listPushSubscriptions(tx, ctx.user.id),
    deliveries: await listRecentDeliveries(tx, ctx.user.id, 15),
    pending: await listPendingReminders(tx, ctx.user.id, 8),
  }));
  const [lastRun] = await withService((tx) => tx<{ started_at: Date; ok: boolean | null }[]>`select started_at, ok from job_runs where job = 'reminders' order by started_at desc limit 1`);
  const schedulerHealthy = isSchedulerHealthy(lastRun);
  const pushReady = pushConfigured();
  const emailReady = emailConfigured();
  const recentFailures = deliveries.filter((d) => d.status !== "accepted");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="font-display text-3xl font-extrabold sm:text-4xl">Settings</h1>

      <Card className="p-5 sm:p-6">
        <h2 className="mb-1 text-xl font-bold">Profile</h2>
        <p className="mb-4 text-sm text-muted">Signed in as {ctx.user.email}</p>
        <ProfileForm name={ctx.profile.display_name} currency={ctx.profile.currency} timeZone={tz} tone={ctx.profile.tone} timeZones={timeZoneOptions(tz)} />
      </Card>

      <Card className="p-5 sm:p-6" id="notifications">
        <h2 className="mb-4 text-xl font-bold">Notifications</h2>
        <div className="mb-5 grid gap-2 text-sm sm:grid-cols-3">
          <StatusLine ok={!!schedulerHealthy} label="Reminder scheduler" detail={lastRun ? `Last ran ${fmt(lastRun.started_at, tz)}` : "Hasn't run yet"} />
          <StatusLine ok={pushReady} label="Push" detail={pushReady ? `${devices.filter((d) => !d.disabled_at).length} active device(s)` : "Not configured on the server"} />
          <StatusLine ok={emailReady && prefs.email_enabled} label="Email" detail={!emailReady ? "Not configured on the server" : prefs.email_enabled ? (prefs.email_address ?? "") : "Turned off"} />
        </div>

        <h3 className="mb-2 font-semibold">This device</h3>
        <PushSetup vapidPublicKey={env().NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} serverReady={pushReady} />

        {devices.length > 0 && (
          <>
            <h3 className="mt-6 mb-2 font-semibold">Your devices</h3>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 p-3">
                  <div>
                    <p className="font-semibold">{d.device_label}</p>
                    <p className={`text-xs ${d.disabled_at ? "text-peach" : d.last_error ? "text-amber" : "text-muted"}`}>
                      {d.disabled_at ? `Inactive: ${d.last_error ?? "removed"}` : d.last_error ? `Last error: ${d.last_error}` : `Last delivered ${fmt(d.last_success_at, tz)}`}
                    </p>
                  </div>
                  <RemoveDeviceButton id={d.id} />
                </li>
              ))}
            </ul>
          </>
        )}

        <h3 className="mt-6 mb-2 font-semibold">Test it</h3>
        <TestButtons />

        <h3 className="mt-6 mb-2 font-semibold">Reminder settings</h3>
        <PreferencesForm prefs={prefs} emailReady={emailReady} />

        <h3 className="mt-6 mb-2 font-semibold">Coming up</h3>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">No reminders queued right now. They&apos;re planned about a day ahead.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {pending.map((r) => (
              <li key={r.id} className="flex justify-between gap-3">
                <span>
                  {KIND[r.kind] ?? r.kind}
                  {r.bill_name ? ` · ${r.bill_name}` : ""} <span className="text-muted">({r.channel})</span>
                </span>
                <span className="text-muted tabular">{fmt(r.send_at, tz)}</span>
              </li>
            ))}
          </ul>
        )}

        <h3 className="mt-6 mb-2 font-semibold">Recent deliveries</h3>
        {recentFailures.length > 0 && (
          <p className="mb-2 flex items-center gap-2 rounded-xl border border-peach/40 bg-peach/5 p-3 text-sm text-peach">
            <AlertTriangle size={16} aria-hidden /> {recentFailures.length} recent delivery problem(s). Details below.
          </p>
        )}
        {deliveries.length === 0 ? (
          <p className="text-sm text-muted">Nothing sent yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line text-sm">
            {deliveries.map((d) => (
              <li key={d.id} className="flex flex-wrap justify-between gap-2 p-3">
                <span>
                  <span className="font-semibold">{d.is_test ? "Test" : (KIND[d.kind ?? ""] ?? "Reminder")}</span>
                  {d.bill_name ? ` · ${d.bill_name}` : ""} · {d.channel}
                  {d.device_label ? ` · ${d.device_label}` : ""}
                  {d.error && <span className="block text-xs text-peach">{d.error}</span>}
                </span>
                <span className={d.status === "accepted" ? "text-ok" : "text-peach"}>
                  {d.status === "accepted" ? "Accepted by provider" : d.status === "expired" ? "Device expired" : "Failed"} · {fmt(d.created_at, tz)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">&ldquo;Accepted&rdquo; means Apple, Google or the email provider took the message. It doesn&apos;t confirm it was displayed or read.</p>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="mb-2 text-xl font-bold">Your data</h2>
        <p className="mb-4 text-sm text-muted">Your bills live in Billy&apos;s database, so they&apos;re the same on every device you sign in to. Export a full copy any time.</p>
        <div className="flex flex-wrap gap-2">
          <a href="/api/export" className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-control)] border border-ivory/80 px-4 font-semibold hover:bg-ivory/5">
            <Download size={18} aria-hidden /> Export everything (JSON)
          </a>
          <a href="/api/export?format=csv" className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-control)] border border-line px-4 font-semibold hover:bg-ivory/5">
            <Download size={18} aria-hidden /> Payments (CSV)
          </a>
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="mb-2 text-xl font-bold">Account</h2>
        <div className="flex flex-wrap items-center gap-3">
          <SignOutButton className="border border-line" />
          <DeleteAccount />
        </div>
        <p className="mt-3 text-xs text-muted">Deleting your account removes all of your data immediately. Database backups kept by the hosting provider age out on their normal schedule.</p>
      </Card>
    </div>
  );
}

function isSchedulerHealthy(run: { started_at: Date; ok: boolean | null } | undefined): boolean {
  return !!run && Date.now() - run.started_at.getTime() < 15 * 60_000 && run.ok !== false;
}

function StatusLine({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className={`rounded-xl border p-3 ${ok ? "border-ok/30" : "border-amber/40"}`}>
      <p className={`flex items-center gap-1.5 font-semibold ${ok ? "text-ok" : "text-amber"}`}>
        {ok ? <CheckCircle2 size={16} aria-hidden /> : <AlertTriangle size={16} aria-hidden />} {label}
      </p>
      <p className="mt-0.5 truncate text-xs text-muted">{detail}</p>
    </div>
  );
}
