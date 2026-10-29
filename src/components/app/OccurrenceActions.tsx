"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ExternalLink, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { cantPayAction, editOccurrenceAction, markPaidAction, skipOccurrenceAction, snoozeAction, undoPaymentAction } from "@/app/actions/payments";
import { formatDateLabel } from "@/lib/domain/dates";
import { formatMoney, minorToInput } from "@/lib/domain/money";
import { hostnameOf } from "@/lib/domain/url";

export interface OccurrenceSummary {
  id: string;
  billId: string;
  billName: string;
  amountMinor: number;
  currency: string;
  dueDate: string;
  status: "open" | "paid" | "skipped";
  autopay: boolean;
  paymentUrl: string | null;
  paymentId: string | null;
  plannedPaymentDate: string | null;
  note: string | null;
}

type Panel = null | "pay" | "menu" | "cantpay" | "edit";

export function OccurrenceActions({ occ, today, compact = false }: { occ: OccurrenceSummary; today: string; compact?: boolean }) {
  const [panel, setPanel] = useState<Panel>(null);
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();

  if (occ.status === "paid") {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled={pending || !occ.paymentId}
        onClick={() =>
          start(async () => {
            const res = await undoPaymentAction(occ.paymentId!, "mistake");
            if (res.ok) {
              toast({ title: "Marked unpaid", body: `${occ.billName} is back on your list.`, mood: "neutral" });
              router.refresh();
            } else toast({ title: res.error, tone: "error" });
          })
        }
      >
        Undo paid
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button variant="secondary" size="sm" onClick={() => setPanel("pay")} aria-label={`Mark ${occ.billName} paid`}>
        <Check size={16} aria-hidden /> {compact ? "Paid" : "Mark paid"}
      </Button>
      <Button variant="ghost" size="sm" className="!px-2" onClick={() => setPanel("menu")} aria-label={`More actions for ${occ.billName}`}>
        <MoreHorizontal size={20} aria-hidden />
      </Button>

      <MarkPaidDialog open={panel === "pay"} occ={occ} today={today} onClose={() => setPanel(null)} />

      <Dialog open={panel === "menu"} onClose={() => setPanel(null)} title={occ.billName}>
        <p className="mb-4 text-sm text-muted">
          {formatMoney(occ.amountMinor, occ.currency)} · due {formatDateLabel(occ.dueDate, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
        </p>
        {occ.paymentUrl && (
          <a href={occ.paymentUrl} target="_blank" rel="noopener noreferrer nofollow" className="mb-3 flex items-center justify-between rounded-xl border border-line p-3 hover:bg-ivory/5">
            <span>
              <span className="block font-semibold">Pay on {hostnameOf(occ.paymentUrl)}</span>
              <span className="block text-sm text-muted">Opens the provider&apos;s website. Billy never sees your bank details.</span>
            </span>
            <ExternalLink size={18} aria-hidden />
          </a>
        )}
        <div className="grid gap-2">
          <MenuButton onClick={() => setPanel("cantpay")} title="Can't pay yet" detail="Set a plan and get reminded. The due date stays the same." />
          <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted">Snooze reminders</p>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["3h", "3 hours"],
                ["tomorrow", "Tomorrow"],
                ["3d", "3 days"],
              ] as const
            ).map(([preset, label]) => (
              <Button
                key={preset}
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await snoozeAction(occ.id, preset);
                    setPanel(null);
                    if (res.ok) {
                      toast({ title: "Snoozed", body: `Next reminder ${new Date(res.until).toLocaleString("en-CA", { weekday: "short", hour: "numeric", minute: "2-digit" })}. Due date unchanged.`, mood: "neutral" });
                      router.refresh();
                    } else toast({ title: res.error, tone: "error" });
                  })
                }
              >
                {label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted">Snoozing changes when Billy reminds you, not when the bill is due.</p>
          <div className="my-2 border-t border-line" />
          <MenuButton onClick={() => setPanel("edit")} title="Edit this occurrence only" detail="Change this cycle's amount or due date. Other cycles stay the same." />
          <MenuButton
            onClick={() =>
              start(async () => {
                const res = await skipOccurrenceAction(occ.id, true);
                setPanel(null);
                if (res.ok) {
                  toast({ title: "Skipped this cycle", body: "No reminders for it. Undo from the bill's history.", mood: "neutral" });
                  router.refresh();
                } else toast({ title: res.error, tone: "error" });
              })
            }
            title="Skip this cycle"
            detail="For a cycle you weren't billed. It won't count as overdue."
          />
          <Link href={`/bills/${occ.billId}`} className="rounded-xl p-3 font-semibold hover:bg-ivory/5">
            View bill and history
          </Link>
        </div>
      </Dialog>

      <CantPayDialog open={panel === "cantpay"} occ={occ} today={today} onClose={() => setPanel(null)} />
      <EditOccurrenceDialog open={panel === "edit"} occ={occ} onClose={() => setPanel(null)} />
    </div>
  );
}

function MenuButton({ onClick, title, detail }: { onClick: () => void; title: string; detail: string }) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl p-3 text-left hover:bg-ivory/5">
      <span className="block font-semibold">{title}</span>
      <span className="block text-sm text-muted">{detail}</span>
    </button>
  );
}

export function MarkPaidDialog({ open, occ, today, onClose }: { open: boolean; occ: OccurrenceSummary; today: string; onClose: () => void }) {
  const [amount, setAmount] = useState(minorToInput(occ.amountMinor, occ.currency));
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  return (
    <Dialog open={open} onClose={onClose} title={`Mark ${occ.billName} paid`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await markPaidAction({ occurrenceId: occ.id, amount, paidOn, note });
            if (!res.ok) {
              setErrors(res.fieldErrors ?? {});
              toast({ title: res.error, tone: "error" });
              return;
            }
            onClose();
            toast({
              title: "Handled.",
              body: res.message,
              mood: "celebrating",
              action: {
                label: "Undo",
                onClick: async () => {
                  const undo = await undoPaymentAction(res.paymentId, "undo");
                  if (undo.ok) toast({ title: "Payment undone", body: `${occ.billName} is unpaid again.`, mood: "neutral" });
                  router.refresh();
                },
              },
            });
            router.refresh();
          });
        }}
        className="space-y-4"
      >
        {occ.autopay && (
          <p className="rounded-xl border border-amber/40 bg-amber/10 p-3 text-sm text-amber">
            This bill is on autopay. Only confirm once you&apos;ve seen the charge go through. Billy can&apos;t check your bank.
          </p>
        )}
        <Field label="Amount paid" htmlFor={`pay-amount-${occ.id}`} error={errors.amount} hint="Full payment only for now.">
          <Input id={`pay-amount-${occ.id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} invalid={!!errors.amount} required className="tabular" />
        </Field>
        <Field label="Payment date" htmlFor={`pay-date-${occ.id}`} error={errors.paid_on}>
          <Input id={`pay-date-${occ.id}`} type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} invalid={!!errors.paid_on} required />
        </Field>
        <Field label="Note (optional)" htmlFor={`pay-note-${occ.id}`} hint="e.g. confirmation number">
          <Input id={`pay-note-${occ.id}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="text-sm text-muted">This records that you paid. It doesn&apos;t move any money.</p>
        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Confirm payment"}
        </Button>
      </form>
    </Dialog>
  );
}

function CantPayDialog({ open, occ, today, onClose }: { open: boolean; occ: OccurrenceSummary; today: string; onClose: () => void }) {
  const [date, setDate] = useState(occ.plannedPaymentDate ?? "");
  const [note, setNote] = useState(occ.note ?? "");
  const [remind, setRemind] = useState(true);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <Dialog open={open} onClose={onClose} title="Can't pay yet?">
      <p className="mb-4 text-muted">That happens. Pick a date you can realistically pay and Billy will remind you then. The due date stays truthful, so it will still show as overdue if it passes.</p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await cantPayAction({ occurrenceId: occ.id, plannedDate: date || null, note, remind });
            if (!res.ok) return toast({ title: res.error, tone: "error" });
            onClose();
            toast({ title: "Plan saved", body: date ? `Billy will check in on ${formatDateLabel(date)}.` : "Note saved.", mood: "all_clear" });
            router.refresh();
          });
        }}
      >
        <Field label="Planned payment date" htmlFor={`plan-date-${occ.id}`}>
          <Input id={`plan-date-${occ.id}`} type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Note (optional)" htmlFor={`plan-note-${occ.id}`} hint="e.g. called them, payment arrangement">
          <Textarea id={`plan-note-${occ.id}`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} className="h-5 w-5 accent-[var(--color-lime)]" />
          Remind me on that date
        </label>
        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          Save plan
        </Button>
      </form>
    </Dialog>
  );
}

function EditOccurrenceDialog({ open, occ, onClose }: { open: boolean; occ: OccurrenceSummary; onClose: () => void }) {
  const [amount, setAmount] = useState(minorToInput(occ.amountMinor, occ.currency));
  const [due, setDue] = useState(occ.dueDate);
  const [note, setNote] = useState(occ.note ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <Dialog open={open} onClose={onClose} title="Edit this occurrence">
      <p className="mb-4 text-sm text-muted">Changes apply to this cycle only. To change every future cycle, edit the bill instead.</p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await editOccurrenceAction({ occurrenceId: occ.id, amount, dueDate: due, note });
            if (!res.ok) {
              setErrors(res.fieldErrors ?? {});
              return toast({ title: res.error, tone: "error" });
            }
            onClose();
            toast({ title: "Saved", body: "Only this cycle changed.", mood: "neutral" });
            router.refresh();
          });
        }}
      >
        <Field label="Amount" htmlFor={`occ-amount-${occ.id}`} error={errors.amount}>
          <Input id={`occ-amount-${occ.id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular" required />
        </Field>
        <Field label="Due date" htmlFor={`occ-due-${occ.id}`} error={errors.due_date}>
          <Input id={`occ-due-${occ.id}`} type="date" value={due} onChange={(e) => setDue(e.target.value)} required />
        </Field>
        <Field label="Note" htmlFor={`occ-note-${occ.id}`}>
          <Input id={`occ-note-${occ.id}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          Save this occurrence
        </Button>
      </form>
    </Dialog>
  );
}
