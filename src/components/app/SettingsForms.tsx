"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteAccountAction, removePushSubscriptionAction, savePreferencesAction, saveProfileAction, scheduleTestReminderAction, sendTestNowAction } from "@/app/actions/settings";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Toggle } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { TONE_LABELS, type Tone } from "@/lib/domain/billy-messages";
import type { PreferencesRow } from "@/lib/data/notifications";
import { clearOfflineCache } from "./ServiceWorker";

function Saved({ state }: { state: { ok: boolean; error?: string } | null }) {
  if (!state) return null;
  return state.ok ? (
    <p role="status" className="text-sm text-ok">
      Saved.
    </p>
  ) : (
    <p role="alert" className="text-sm text-peach">
      {state.error}
    </p>
  );
}

export function ProfileForm({ name, currency, timeZone, tone, timeZones }: { name: string; currency: string; timeZone: string; tone: Tone; timeZones: string[] }) {
  const [state, action, pending] = useActionState(saveProfileAction, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="space-y-4">
      <Field label="Name" htmlFor="display_name" error={errors.display_name}>
        <Input id="display_name" name="display_name" defaultValue={name} maxLength={60} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Currency" htmlFor="currency" hint="Used for new bills. Existing bills keep their currency.">
          <Select id="currency" name="currency" defaultValue={currency}>
            {["CAD", "USD", "EUR", "GBP"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Time zone" htmlFor="time_zone" error={errors.time_zone} hint="Due dates and reminder times follow this zone.">
          <Select id="time_zone" name="time_zone" defaultValue={timeZone}>
            {timeZones.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Billy&apos;s tone</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(TONE_LABELS) as Tone[]).map((t) => (
            <label key={t} className="flex items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-lime">
              <input type="radio" name="tone" value={t} defaultChecked={t === tone} className="mt-1 h-5 w-5 accent-[var(--color-lime)]" />
              <span>
                <span className="block font-semibold">{TONE_LABELS[t].label}</span>
                <span className="block text-sm text-muted">{TONE_LABELS[t].description}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">Tone only changes Billy&apos;s words. It never changes how often you&apos;re reminded.</p>
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
        <Saved state={state} />
      </div>
    </form>
  );
}

const OFFSETS = [
  { v: 7, label: "1 week before" },
  { v: 3, label: "3 days before" },
  { v: 1, label: "1 day before" },
  { v: 0, label: "On the due date" },
];

export function PreferencesForm({ prefs, emailReady }: { prefs: PreferencesRow; emailReady: boolean }) {
  const [state, action, pending] = useActionState(savePreferencesAction, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const [email, setEmail] = useState(prefs.email_enabled);
  return (
    <form action={action} className="space-y-5">
      <div className="divide-y divide-line">
        <Toggle name="push_enabled" label="Push notifications" description="On every device where you've turned them on." defaultChecked={prefs.push_enabled} />
        <div>
          <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
            <span>
              <span className="block font-semibold">Email reminders</span>
              <span className="block text-sm text-muted">{emailReady ? "Brief emails with a link back to Billy." : "Email isn't configured on the server yet."}</span>
            </span>
            <input type="checkbox" name="email_enabled" checked={email} onChange={(e) => setEmail(e.target.checked)} className="mt-1 h-6 w-6 accent-[var(--color-lime)]" />
          </label>
          {email && (
            <div className="pb-3">
              <Field label="Send reminders to" htmlFor="email_address" error={errors.email_address}>
                <Input id="email_address" name="email_address" type="email" defaultValue={prefs.email_address ?? ""} />
              </Field>
            </div>
          )}
          {!email && <input type="hidden" name="email_address" value={prefs.email_address ?? ""} />}
        </div>
        <Toggle name="lock_screen_details" label="Show bill names and amounts on the lock screen" description="Off: notifications just say a bill needs attention." defaultChecked={prefs.lock_screen_details} />
      </div>

      <fieldset>
        <legend className="mb-2 font-semibold">Default reminder timing</legend>
        <div className="grid grid-cols-2 gap-2">
          {OFFSETS.map((o) => (
            <label key={o.v} className="flex items-center gap-2 rounded-xl border border-line p-3 has-[:checked]:border-lime">
              <input type="checkbox" name="default_offsets" value={o.v} defaultChecked={prefs.default_offsets.includes(o.v)} className="h-4 w-4 accent-[var(--color-lime)]" />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Reminder time" htmlFor="reminder_hour">
          <Select id="reminder_hour" name="reminder_hour" defaultValue={String(prefs.reminder_hour)}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {new Date(2000, 0, 1, h).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Max notifications per day" htmlFor="max_per_day" hint="Bills due together are grouped into one notification.">
          <Input id="max_per_day" name="max_per_day" type="number" min={1} max={20} defaultValue={prefs.max_per_day} />
        </Field>
      </div>

      <div className="divide-y divide-line">
        <Toggle name="overdue_followups" label="Overdue follow-ups" description="A daily nudge after the due date, for a limited number of days." defaultChecked={prefs.overdue_followups} />
        <div className="py-2">
          <Field label="Follow up for up to (days)" htmlFor="overdue_followup_days">
            <Input id="overdue_followup_days" name="overdue_followup_days" type="number" min={0} max={14} defaultValue={prefs.overdue_followup_days} />
          </Field>
        </div>
        <Toggle name="quiet_hours_enabled" label="Quiet hours" description="Reminders that land in quiet hours wait until they end." defaultChecked={prefs.quiet_hours_enabled} />
        <div className="grid grid-cols-2 gap-4 py-2">
          <Field label="From" htmlFor="quiet_start">
            <Input id="quiet_start" name="quiet_start" type="time" defaultValue={prefs.quiet_start} />
          </Field>
          <Field label="Until" htmlFor="quiet_end">
            <Input id="quiet_end" name="quiet_end" type="time" defaultValue={prefs.quiet_end} />
          </Field>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save reminder settings"}
        </Button>
        <Saved state={state} />
      </div>
    </form>
  );
}

export function TestButtons() {
  const [pending, start] = useTransition();
  const [results, setResults] = useState<{ channel: string; status: string; detail: string }[] | null>(null);
  const [scheduled, setScheduled] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await sendTestNowAction();
              if (res.ok) setResults(res.results);
              else toast({ title: res.error, tone: "error" });
              router.refresh();
            })
          }
        >
          Send test now
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await scheduleTestReminderAction();
              if (res.ok) setScheduled(res.sendAt);
              else toast({ title: res.error, tone: "error" });
              router.refresh();
            })
          }
        >
          Schedule a test in 2 minutes
        </Button>
      </div>
      <p className="text-sm text-muted">&ldquo;Send test now&rdquo; checks delivery. The scheduled test goes through the background scheduler, so close Billy after tapping it to confirm reminders arrive while the app is closed.</p>
      {scheduled && (
        <p role="status" className="rounded-xl border border-lime/40 bg-lime/5 p-3 text-sm">
          Test scheduled for {new Date(scheduled).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}. Close Billy now. It should arrive within about 5 minutes of that time.
        </p>
      )}
      {results && (
        <ul className="space-y-1 text-sm" role="status">
          {results.map((r, i) => (
            <li key={i} className={r.status === "accepted" ? "text-ok" : r.status === "off" ? "text-muted" : "text-peach"}>
              <span className="font-semibold">{r.channel}:</span> {r.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RemoveDeviceButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await removePushSubscriptionAction({ id });
          router.refresh();
        })
      }
    >
      Remove
    </Button>
  );
}

export function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete account
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Delete your account?">
        <p className="text-muted">This permanently deletes your profile, bills, payment history, reminders and devices. It can&apos;t be undone. Export your data first if you want a copy.</p>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await deleteAccountAction(text);
              if (!res.ok) return setError(res.error);
              await clearOfflineCache();
              router.replace("/sign-in");
              router.refresh();
            });
          }}
        >
          <Field label='Type DELETE to confirm' htmlFor="delete-confirm" error={error ?? undefined}>
            <Input id="delete-confirm" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
          </Field>
          <Button type="submit" variant="danger" disabled={pending || text !== "DELETE"}>
            Delete everything
          </Button>
        </form>
      </Dialog>
    </>
  );
}
