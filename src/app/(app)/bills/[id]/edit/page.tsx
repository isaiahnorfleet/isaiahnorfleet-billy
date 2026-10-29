import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getBill } from "@/lib/data/bills";
import { getPreferences } from "@/lib/data/notifications";
import { minorToInput } from "@/lib/domain/money";
import { pageContext, withFreshData } from "@/lib/server/context";
import { BillForm } from "@/components/app/BillForm";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Edit bill" };

export default async function EditBillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await pageContext();
  const data = await withFreshData(ctx, async (tx) => {
    const bill = await getBill(tx, ctx.user.id, id);
    if (!bill) return null;
    const [next] = await tx<{ scheduled_date: string }[]>`
      select scheduled_date from bill_occurrences where bill_id = ${id} and status = 'open' and scheduled_date >= ${ctx.today} order by scheduled_date limit 1`;
    return { bill, nextDue: next?.scheduled_date ?? bill.anchor_date, prefs: await getPreferences(tx, ctx.user.id) };
  });
  if (!data) notFound();
  const { bill, nextDue, prefs } = data;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href={`/bills/${id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ivory">
        <ChevronLeft size={16} aria-hidden /> {bill.name}
      </Link>
      <h1 className="font-display text-3xl font-extrabold">Edit bill</h1>
      <Card className="space-y-2 p-4 text-sm text-muted">
        <p className="font-semibold text-ivory">What changes apply to</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Name, category, notes, link, autopay and reminders: the whole bill.</li>
          <li>Amount: upcoming unpaid cycles. Overdue and paid cycles keep their amounts.</li>
          <li>Next due date or how it repeats: resets the schedule from that date. Overdue and paid cycles stay in history.</li>
          <li>To change just one cycle, use &ldquo;Edit this occurrence only&rdquo; from the bill&apos;s ••• menu.</li>
        </ul>
      </Card>
      <Card className="p-5 sm:p-6">
        <BillForm
          initial={{
            id: bill.id,
            name: bill.name,
            amount: minorToInput(bill.amount_minor, bill.currency),
            currency: bill.currency,
            category: bill.category,
            recurrence: bill.recurrence,
            due_date: nextDue,
            autopay: bill.autopay,
            payment_url: bill.payment_url ?? "",
            notes: bill.notes ?? "",
            reminders_enabled: bill.reminders_enabled,
            reminder_offsets: bill.reminder_offsets,
          }}
          today={ctx.today}
          defaultOffsets={prefs.default_offsets}
          submitLabel="Save changes"
        />
      </Card>
    </div>
  );
}
