import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { withUser } from "@/lib/db/client";
import { getPreferences } from "@/lib/data/notifications";
import { pageContext } from "@/lib/server/context";
import { BillForm } from "@/components/app/BillForm";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Add a bill" };

export default async function NewBillPage() {
  const ctx = await pageContext();
  const prefs = await withUser(ctx.user.id, (tx) => getPreferences(tx, ctx.user.id));
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/bills" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ivory">
        <ChevronLeft size={16} aria-hidden /> My bills
      </Link>
      <h1 className="font-display text-3xl font-extrabold">Add a bill</h1>
      <Card className="p-5 sm:p-6">
        <BillForm
          initial={{ name: "", amount: "", currency: ctx.profile.currency, category: "other", recurrence: "monthly", due_date: "", autopay: false, autopay_account: "", payment_url: "", notes: "", reminders_enabled: true, reminder_offsets: null }}
          today={ctx.today}
          defaultOffsets={prefs.default_offsets}
          submitLabel="Add bill"
        />
      </Card>
    </div>
  );
}
