"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { correctPaymentAction, undoPaymentAction } from "@/app/actions/payments";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { minorToInput } from "@/lib/domain/money";

export function PaymentActions({ id, billName, amountMinor, currency, paidOn, note, today }: { id: string; billName: string; amountMinor: number; currency: string; paidOn: string; note: string | null; today: string }) {
  const [open, setOpen] = useState<null | "menu" | "correct">(null);
  const [amount, setAmount] = useState(minorToInput(amountMinor, currency));
  const [date, setDate] = useState(paidOn);
  const [text, setText] = useState(note ?? "");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <>
      <Button variant="ghost" size="sm" className="!px-2" onClick={() => setOpen("menu")} aria-label={`Actions for ${billName} payment`}>
        <MoreHorizontal size={20} aria-hidden />
      </Button>
      <Dialog open={open === "menu"} onClose={() => setOpen(null)} title={`${billName} payment`}>
        <div className="grid gap-2">
          <button type="button" className="rounded-xl p-3 text-left hover:bg-ivory/5" onClick={() => setOpen("correct")}>
            <span className="block font-semibold">Correct amount or date</span>
            <span className="block text-sm text-muted">Keeps the original in history, marked as corrected.</span>
          </button>
          <button
            type="button"
            className="rounded-xl p-3 text-left hover:bg-ivory/5"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await undoPaymentAction(id, "mistake");
                setOpen(null);
                if (res.ok) {
                  toast({ title: "Marked as not paid", body: `${billName} is back on your list with its original due date.`, mood: "neutral" });
                  router.refresh();
                } else toast({ title: res.error, tone: "error" });
              })
            }
          >
            <span className="block font-semibold text-peach">I didn&apos;t actually pay this</span>
            <span className="block text-sm text-muted">Undo the &ldquo;paid&rdquo; mark. The bill becomes unpaid again.</span>
          </button>
        </div>
      </Dialog>
      <Dialog open={open === "correct"} onClose={() => setOpen(null)} title="Correct payment">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await correctPaymentAction({ paymentId: id, amount, paidOn: date, note: text });
              if (!res.ok) return toast({ title: res.error, tone: "error" });
              setOpen(null);
              toast({ title: "Payment corrected", mood: "neutral" });
              router.refresh();
            });
          }}
        >
          <Field label="Amount paid" htmlFor={`amt-${id}`}>
            <Input id={`amt-${id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular" />
          </Field>
          <Field label="Payment date" htmlFor={`date-${id}`}>
            <Input id={`date-${id}`} type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Note" htmlFor={`note-${id}`}>
            <Input id={`note-${id}`} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" disabled={pending}>
            Save correction
          </Button>
        </form>
      </Dialog>
    </>
  );
}
