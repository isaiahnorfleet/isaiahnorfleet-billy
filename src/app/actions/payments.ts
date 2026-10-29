"use server";

import { revalidatePath } from "next/cache";
import { withUser } from "@/lib/db/client";
import { emailConfigured, pushConfigured } from "@/lib/env";
import { requireUserForAction } from "@/lib/auth/session";
import { availableChannels, getPreferences, snoozeOccurrence } from "@/lib/data/notifications";
import { correctPayment, editOccurrence, PaymentError, recordPayment, setOccurrenceSkipped, voidPayment } from "@/lib/data/payments";
import { paidMessage } from "@/lib/domain/billy-messages";
import { addDays, todayIn, zonedInstant } from "@/lib/domain/dates";
import { parseAmountToMinor } from "@/lib/domain/money";
import { cantPayInput, fieldErrors, localDate, occurrenceEditInput, paymentInput } from "@/lib/validation";
import { failure, type ActionResult } from "./result";

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof PaymentError) return err.message;
  console.error(fallback, (err as Error)?.message);
  return fallback;
}

export async function markPaidAction(input: { occurrenceId: string; amount: string; paidOn: string; note?: string }): Promise<ActionResult<{ paymentId: string; message: string; billName: string }>> {
  try {
    const { user, profile } = await requireUserForAction();
    const parsed = paymentInput.safeParse({ occurrence_id: input.occurrenceId, amount: input.amount, paid_on: input.paidOn, note: input.note });
    if (!parsed.success) return failure("Please check the payment details.", fieldErrors(parsed.error));
    const amountMinor = parseAmountToMinor(parsed.data.amount);
    if (amountMinor === null) return failure("Enter the amount you paid, like 79.99.", { amount: "Enter an amount like 79.99" });
    const today = todayIn(profile.time_zone);
    if (parsed.data.paid_on > today) return failure("The payment date can't be in the future.", { paid_on: "Can't be in the future" });
    const { paymentId, billName } = await withUser(user.id, (tx) =>
      recordPayment(tx, user.id, { occurrenceId: parsed.data.occurrence_id, amountMinor, paidOn: parsed.data.paid_on, note: parsed.data.note }),
    );
    revalidatePath("/", "layout");
    return { ok: true, paymentId, billName, message: paidMessage(profile.tone, billName, paymentId) };
  } catch (err) {
    return failure(errorMessage(err, "Couldn't record the payment. Nothing was saved."));
  }
}

export async function undoPaymentAction(paymentId: string, reason: "undo" | "mistake" = "undo"): Promise<ActionResult> {
  try {
    const { user } = await requireUserForAction();
    await withUser(user.id, (tx) => voidPayment(tx, user.id, paymentId, reason));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return failure(errorMessage(err, "Couldn't undo the payment. Try again."));
  }
}

export async function correctPaymentAction(input: { paymentId: string; amount: string; paidOn: string; note?: string }): Promise<ActionResult> {
  try {
    const { user, profile } = await requireUserForAction();
    const amountMinor = parseAmountToMinor(input.amount);
    const date = localDate.safeParse(input.paidOn);
    if (amountMinor === null || !date.success) return failure("Check the amount and date.");
    if (date.data > todayIn(profile.time_zone)) return failure("The payment date can't be in the future.");
    await withUser(user.id, (tx) => correctPayment(tx, user.id, input.paymentId, { amountMinor, paidOn: date.data, note: input.note?.trim() || null }));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return failure(errorMessage(err, "Couldn't correct the payment."));
  }
}

export async function editOccurrenceAction(input: { occurrenceId: string; amount: string; dueDate: string; note?: string }): Promise<ActionResult> {
  try {
    const { user } = await requireUserForAction();
    const parsed = occurrenceEditInput.safeParse({ occurrence_id: input.occurrenceId, amount: input.amount, due_date: input.dueDate, note: input.note });
    if (!parsed.success) return failure("Check the details.", fieldErrors(parsed.error));
    const amountMinor = parseAmountToMinor(parsed.data.amount);
    if (amountMinor === null) return failure("Enter an amount like 79.99.", { amount: "Enter an amount like 79.99" });
    await withUser(user.id, (tx) => editOccurrence(tx, user.id, { occurrenceId: parsed.data.occurrence_id, amountMinor, dueDate: parsed.data.due_date, note: parsed.data.note }));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return failure(errorMessage(err, "Couldn't save the change."));
  }
}

/** Snooze reminders: "later today" (+3h), "tomorrow" (9:00 or reminder hour), or a date. Due date never changes. */
export async function snoozeAction(occurrenceId: string, preset: "3h" | "tomorrow" | "3d"): Promise<ActionResult<{ until: string }>> {
  try {
    const { user, profile } = await requireUserForAction();
    const result = await withUser(user.id, async (tx) => {
      const prefs = await getPreferences(tx, user.id);
      const today = todayIn(profile.time_zone);
      const until =
        preset === "3h"
          ? new Date(Date.now() + 3 * 3600_000)
          : zonedInstant(addDays(today, preset === "tomorrow" ? 1 : 3), prefs.reminder_hour * 60, profile.time_zone);
      const channels = await availableChannels(tx, user.id, emailConfigured(), pushConfigured());
      await snoozeOccurrence(tx, user.id, occurrenceId, until, channels);
      return until;
    });
    revalidatePath("/", "layout");
    return { ok: true, until: result.toISOString() };
  } catch (err) {
    return failure(errorMessage(err, "Couldn't snooze that reminder."));
  }
}

/** "Can't pay yet": record a plan and get reminded on that date. The due date and overdue status stay truthful. */
export async function cantPayAction(input: { occurrenceId: string; plannedDate: string | null; note?: string; remind: boolean }): Promise<ActionResult> {
  try {
    const { user, profile } = await requireUserForAction();
    const parsed = cantPayInput.safeParse({ occurrence_id: input.occurrenceId, planned_payment_date: input.plannedDate || null, note: input.note, remind: input.remind });
    if (!parsed.success) return failure("Check the details.", fieldErrors(parsed.error));
    const today = todayIn(profile.time_zone);
    if (parsed.data.planned_payment_date && parsed.data.planned_payment_date < today) return failure("Pick today or a later date.", { planned_payment_date: "Pick today or later" });
    await withUser(user.id, async (tx) => {
      await tx`update bill_occurrences set planned_payment_date = ${parsed.data.planned_payment_date}, note = coalesce(${parsed.data.note}, note)
               where id = ${parsed.data.occurrence_id} and user_id = ${user.id} and status = 'open'`;
      if (parsed.data.remind && parsed.data.planned_payment_date) {
        const prefs = await getPreferences(tx, user.id);
        const until = zonedInstant(parsed.data.planned_payment_date, prefs.reminder_hour * 60, profile.time_zone);
        if (until.getTime() > Date.now()) {
          const channels = await availableChannels(tx, user.id, emailConfigured(), pushConfigured());
          await snoozeOccurrence(tx, user.id, parsed.data.occurrence_id, until, channels);
        }
      }
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return failure(errorMessage(err, "Couldn't save your plan."));
  }
}

export async function skipOccurrenceAction(occurrenceId: string, skipped: boolean): Promise<ActionResult> {
  try {
    const { user } = await requireUserForAction();
    await withUser(user.id, (tx) => setOccurrenceSkipped(tx, user.id, occurrenceId, skipped));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return failure(errorMessage(err, "Couldn't update that occurrence."));
  }
}
