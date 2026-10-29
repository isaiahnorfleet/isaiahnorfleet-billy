"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { saveBillAction } from "@/app/actions/bills";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/domain/categories";
import { RECURRENCES, RECURRENCE_LABELS, type Recurrence } from "@/lib/domain/recurrence";

export interface BillFormValues {
  id?: string;
  name: string;
  amount: string;
  currency: string;
  category: string;
  recurrence: Recurrence;
  due_date: string;
  autopay: boolean;
  payment_url: string;
  notes: string;
  reminders_enabled: boolean;
  reminder_offsets: number[] | null;
}

const OFFSET_CHOICES = [
  { v: 7, label: "1 week before" },
  { v: 3, label: "3 days before" },
  { v: 1, label: "1 day before" },
  { v: 0, label: "On the due date" },
];

export function BillForm({
  initial,
  today,
  defaultOffsets,
  submitLabel,
  onSaved,
}: {
  initial: BillFormValues;
  today: string;
  defaultOffsets: number[];
  submitLabel: string;
  onSaved?: (billId: string) => void;
}) {
  const [state, action, pending] = useActionState(saveBillAction, null);
  const router = useRouter();
  const isEdit = Boolean(initial.id);
  const [remindMode, setRemindMode] = useState<"default" | "custom" | "off">(!initial.reminders_enabled ? "off" : initial.reminder_offsets ? "custom" : "default");
  const [recurrence, setRecurrence] = useState<Recurrence>(initial.recurrence);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  useEffect(() => {
    if (state?.ok) {
      if (onSaved) onSaved(state.billId);
      else router.push(`/bills/${state.billId}?saved=1`);
    }
  }, [state, onSaved, router]);

  const errId = (k: string) => (errors[k] ? `${k}-error` : undefined);

  return (
    <form action={action} className="space-y-5" noValidate>
      {initial.id && <input type="hidden" name="bill_id" value={initial.id} />}
      <input type="hidden" name="currency" value={initial.currency} />
      {state && !state.ok && (
        <p role="alert" className="rounded-xl border border-peach/50 bg-peach/10 p-3 text-peach">
          {state.error}
        </p>
      )}

      <Field label="Bill name" htmlFor="name" error={errors.name}>
        <Input id="name" name="name" defaultValue={initial.name} placeholder="Bill name or merchant" maxLength={80} required autoComplete="off" invalid={!!errors.name} aria-describedby={errId("name")} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={`Amount (${initial.currency})`} htmlFor="amount" error={errors.amount} hint={isEdit ? "Applies to upcoming unpaid cycles. Overdue and paid ones keep their amount." : undefined}>
          <Input id="amount" name="amount" inputMode="decimal" defaultValue={initial.amount} placeholder="0.00" required className="tabular" invalid={!!errors.amount} aria-describedby={errId("amount")} />
        </Field>
        <Field label="Category" htmlFor="category">
          <Select id="category" name="category" defaultValue={initial.category}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Repeats" htmlFor="recurrence">
          <Select id="recurrence" name="recurrence" value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
            {RECURRENCES.map((r) => (
              <option key={r} value={r}>
                {RECURRENCE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={isEdit ? "Next due date" : recurrence === "once" ? "Due date" : "Next due date"}
          htmlFor="due_date"
          error={errors.due_date}
          hint={
            isEdit
              ? "Changing this or how it repeats resets the schedule from this date. Overdue and paid cycles are kept."
              : recurrence === "monthly" || recurrence === "quarterly" || recurrence === "yearly"
                ? "Bills due on the 29th to 31st use the last day of shorter months, then return to their usual day."
                : undefined
          }
        >
          <Input id="due_date" name="due_date" type="date" defaultValue={initial.due_date || today} required invalid={!!errors.due_date} />
        </Field>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-line p-3">
        <input type="checkbox" name="autopay" defaultChecked={initial.autopay} className="mt-1 h-5 w-5 accent-[var(--color-lime)]" />
        <span>
          <span className="block font-semibold">On autopay</span>
          <span className="block text-sm text-muted">Billy will still ask you to confirm the charge went through. Autopay isn&apos;t the same as paid.</span>
        </span>
      </label>

      <Field label="Payment website (optional)" htmlFor="payment_url" error={errors.payment_url} hint="Where you pay this bill. You'll pay on their site; Billy never asks for bank logins.">
        <Input id="payment_url" name="payment_url" type="url" inputMode="url" defaultValue={initial.payment_url} placeholder="https://" invalid={!!errors.payment_url} />
      </Field>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">Reminders for this bill</legend>
        {(
          [
            ["default", `Use my defaults (${defaultOffsets.length ? defaultOffsets.map((d) => (d === 0 ? "due day" : `${d}d before`)).join(", ") : "none"})`],
            ["custom", "Custom for this bill"],
            ["off", "No reminders for this bill"],
          ] as const
        ).map(([v, label]) => (
          <label key={v} className="flex items-center gap-3">
            <input type="radio" name="remind_mode" value={v} checked={remindMode === v} onChange={() => setRemindMode(v)} className="h-5 w-5 accent-[var(--color-lime)]" />
            {label}
          </label>
        ))}
        {remindMode === "custom" && (
          <div className="ml-8 grid grid-cols-2 gap-2 pt-1">
            {OFFSET_CHOICES.map((o) => (
              <label key={o.v} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="reminder_offsets"
                  value={o.v}
                  defaultChecked={(initial.reminder_offsets ?? defaultOffsets).includes(o.v)}
                  className="h-4 w-4 accent-[var(--color-lime)]"
                />
                {o.label}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <Field label="Notes (optional)" htmlFor="notes">
        <Textarea id="notes" name="notes" defaultValue={initial.notes} maxLength={1000} placeholder="Account number hint, who to call…" />
      </Field>

      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
