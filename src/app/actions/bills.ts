"use server";

import { revalidatePath } from "next/cache";
import { withUser } from "@/lib/db/client";
import { requireUserForAction } from "@/lib/auth/session";
import { createBill, deleteBill, setBillArchived, updateBill } from "@/lib/data/bills";
import { todayIn } from "@/lib/domain/dates";
import { billInput, fieldErrors } from "@/lib/validation";
import { failure, type ActionResult } from "./result";

function parseBillForm(form: FormData) {
  const remindMode = String(form.get("remind_mode") ?? "default");
  const offsets = form.getAll("reminder_offsets").map(String);
  return billInput.safeParse({
    name: String(form.get("name") ?? ""),
    amount: String(form.get("amount") ?? ""),
    currency: String(form.get("currency") ?? "CAD"),
    category: String(form.get("category") ?? "other"),
    recurrence: String(form.get("recurrence") ?? ""),
    due_date: String(form.get("due_date") ?? ""),
    autopay: form.get("autopay") === "on",
    autopay_account: String(form.get("autopay_account") ?? ""),
    payment_url: String(form.get("payment_url") ?? ""),
    notes: String(form.get("notes") ?? ""),
    reminders_enabled: remindMode !== "off",
    reminder_offsets: remindMode === "custom" ? offsets : null,
  });
}

export async function saveBillAction(_prev: ActionResult<{ billId?: string }> | null, form: FormData): Promise<ActionResult<{ billId: string }>> {
  try {
    const { user, profile } = await requireUserForAction();
    const parsed = parseBillForm(form);
    if (!parsed.success) return failure("Please fix the highlighted fields.", fieldErrors(parsed.error));
    const today = todayIn(profile.time_zone);
    const billId = String(form.get("bill_id") ?? "");
    const id = await withUser(user.id, async (tx) => {
      if (billId) {
        await updateBill(tx, user.id, billId, parsed.data, today);
        return billId;
      }
      return createBill(tx, user.id, parsed.data, today);
    });
    revalidatePath("/", "layout");
    return { ok: true, billId: id };
  } catch (err) {
    console.error("saveBill failed", (err as Error).message);
    return failure("Couldn't save the bill. Check your connection and try again.");
  }
}

export async function archiveBillAction(billId: string, archived: boolean): Promise<ActionResult> {
  try {
    const { user, profile } = await requireUserForAction();
    await withUser(user.id, (tx) => setBillArchived(tx, user.id, billId, archived, todayIn(profile.time_zone)));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return failure("Couldn't update the bill. Try again.");
  }
}

export async function deleteBillAction(billId: string, confirmName: string): Promise<ActionResult> {
  try {
    const { user } = await requireUserForAction();
    const ok = await withUser(user.id, async (tx) => {
      const [bill] = await tx<{ name: string }[]>`select name from bills where id = ${billId}`;
      if (!bill || bill.name.trim().toLowerCase() !== confirmName.trim().toLowerCase()) return false;
      return deleteBill(tx, user.id, billId);
    });
    if (!ok) return failure("Type the bill's name exactly to confirm.");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return failure("Couldn't delete the bill. Try again.");
  }
}
