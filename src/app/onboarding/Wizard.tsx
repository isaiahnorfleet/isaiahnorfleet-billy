"use client";

import { useActionState, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BillyMascot } from "@/components/billy/BillyMascot";
import { BillForm } from "@/components/app/BillForm";
import { PushSetup } from "@/components/app/PushSetup";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { finishOnboardingAction, saveProfileAction } from "@/app/actions/settings";
import { TONE_LABELS, type Tone } from "@/lib/domain/billy-messages";

const STEPS = ["Meet Billy", "About you", "First bill", "Reminders"];

export function OnboardingWizard(props: {
  name: string;
  currency: string;
  timeZone: string;
  tone: Tone;
  today: string;
  timeZones: string[];
  vapidPublicKey: string | null;
  pushReady: boolean;
  defaultOffsets: number[];
}) {
  const [step, setStep] = useState(0);
  const [profileState, profileAction, profilePending] = useActionState(async (prev: Awaited<ReturnType<typeof saveProfileAction>> | null, form: FormData) => {
    const res = await saveProfileAction(prev, form);
    if (res.ok) setStep(2);
    return res;
  }, null);
  const [finishing, startFinish] = useTransition();
  const detectedTz = useSyncExternalStore(
    () => () => {},
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null,
  );
  const router = useRouter();

  const finish = () =>
    startFinish(async () => {
      await finishOnboardingAction();
      router.replace("/");
      router.refresh();
    });

  return (
    <div className="mx-auto max-w-xl px-5 pt-[calc(1.5rem+var(--safe-top))] pb-16">
      <ol className="mb-8 flex gap-2" aria-label="Setup progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <span className={`block h-1.5 rounded-full ${i <= step ? "bg-lime" : "bg-line"}`} />
            <span className={`mt-1.5 block text-xs ${i === step ? "text-ivory" : "text-muted"}`} aria-current={i === step ? "step" : undefined}>
              {s}
            </span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className="text-center">
          <BillyMascot mood="heads_up" size={150} className="mx-auto" />
          <h1 className="mt-6 font-display text-4xl font-extrabold">I&apos;m Billy.</h1>
          <p className="mx-auto mt-3 max-w-md text-lg text-muted">
            I keep track of what you owe and when, remind you before it&apos;s due, and cheer when it&apos;s handled. Straight talk, always on your side.
          </p>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted">I never move money or connect to your bank. You pay your bills where you always do, then tell me it&apos;s done.</p>
          <Button size="lg" className="mt-8 w-full sm:w-auto" onClick={() => setStep(1)}>
            Let&apos;s go
          </Button>
        </section>
      )}

      {step === 1 && (
        <section>
          <h1 className="font-display text-3xl font-extrabold">First, the basics.</h1>
          <p className="mt-2 mb-6 text-muted">Due dates and reminders follow your time zone.</p>
          <form action={profileAction} className="space-y-5">
            <Field label="What should Billy call you?" htmlFor="display_name" error={profileState && !profileState.ok ? profileState.fieldErrors?.display_name : undefined}>
              <Input id="display_name" name="display_name" defaultValue={props.name} maxLength={60} autoComplete="given-name" />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Currency" htmlFor="currency">
                <Select id="currency" name="currency" defaultValue={props.currency}>
                  {["CAD", "USD", "EUR", "GBP"].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Time zone" htmlFor="time_zone" hint={detectedTz && detectedTz !== props.timeZone ? `This device says ${detectedTz}.` : undefined}>
                <Select id="time_zone" name="time_zone" defaultValue={props.timeZone}>
                  {props.timeZones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">How should Billy talk to you?</legend>
              <div className="grid gap-2">
                {(Object.keys(TONE_LABELS) as Tone[]).map((t) => (
                  <label key={t} className="flex items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-lime">
                    <input type="radio" name="tone" value={t} defaultChecked={t === props.tone} className="mt-1 h-5 w-5 accent-[var(--color-lime)]" />
                    <span>
                      <span className="block font-semibold">{TONE_LABELS[t].label}</span>
                      <span className="block text-sm text-muted">{TONE_LABELS[t].description}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">Tone changes Billy&apos;s words, never how often you&apos;re reminded.</p>
            </fieldset>
            {profileState && !profileState.ok && <p role="alert" className="text-peach">{profileState.error}</p>}
            <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={profilePending}>
              {profilePending ? "Saving…" : "Continue"}
            </Button>
          </form>
        </section>
      )}

      {step === 2 && (
        <section>
          <h1 className="font-display text-3xl font-extrabold">Add your first real bill.</h1>
          <p className="mt-2 mb-6 text-muted">Rent, hydro, phone… whatever&apos;s next. You can add the rest later.</p>
          <BillForm
            initial={{ name: "", amount: "", currency: props.currency, category: "other", recurrence: "monthly", due_date: "", autopay: false, autopay_account: "", payment_url: "", notes: "", reminders_enabled: true, reminder_offsets: null }}
            today={props.today}
            defaultOffsets={props.defaultOffsets}
            submitLabel="Add bill"
            onSaved={() => setStep(3)}
          />
          <button type="button" className="mt-4 text-sm text-muted underline" onClick={() => setStep(3)}>
            Skip for now
          </button>
        </section>
      )}

      {step === 3 && (
        <section>
          <h1 className="font-display text-3xl font-extrabold">How reminders work.</h1>
          <ul className="mt-4 mb-6 space-y-2 text-muted">
            <li>• 3 days before, 1 day before, and on the due date at 9:00 AM.</li>
            <li>• If something slips, a daily nudge for up to 5 days. You can change all of this.</li>
            <li>• Quiet hours from 9 PM to 8 AM. Nothing will buzz overnight.</li>
            <li>• Lock-screen notifications hide bill names and amounts unless you allow them.</li>
          </ul>
          <PushSetup vapidPublicKey={props.vapidPublicKey} serverReady={props.pushReady} />
          <p className="mt-4 text-sm text-muted">Prefer email? You can turn on email reminders in Settings.</p>
          <Button size="lg" className="mt-8 w-full sm:w-auto" onClick={finish} disabled={finishing}>
            {finishing ? "Finishing…" : "Go to my dashboard"}
          </Button>
        </section>
      )}
    </div>
  );
}
