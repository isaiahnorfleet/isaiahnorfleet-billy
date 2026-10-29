import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { getBill } from "@/lib/data/bills";
import { listOccurrencesForBill } from "@/lib/data/occurrences";
import { CATEGORY_LABELS, type Category } from "@/lib/domain/categories";
import { formatDateLabel, relativeDayLabel } from "@/lib/domain/dates";
import { RECURRENCE_LABELS, nextOccurrenceOnOrAfter } from "@/lib/domain/recurrence";
import { occurrenceState } from "@/lib/domain/status";
import { hostnameOf } from "@/lib/domain/url";
import { pageContext, withFreshData } from "@/lib/server/context";
import { BillManage, UnskipButton } from "@/components/app/BillManage";
import { OccurrenceActions } from "@/components/app/OccurrenceActions";
import { Card, SectionTitle } from "@/components/ui/Card";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { Money } from "@/components/ui/Money";
import { StatusChip } from "@/components/ui/StatusChip";

export const metadata: Metadata = { title: "Bill" };

export default async function BillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ occurrence?: string; saved?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await pageContext();
  const data = await withFreshData(ctx, async (tx) => {
    const bill = await getBill(tx, ctx.user.id, id);
    if (!bill) return null;
    return { bill, occurrences: await listOccurrencesForBill(tx, ctx.user.id, id) };
  });
  if (!data) notFound();
  const { bill, occurrences } = data;
  const withState = occurrences.map((o) => ({ ...o, state: occurrenceState(o.status, o.due_date, ctx.today) }));
  const open = withState.filter((o) => o.status === "open").sort((a, b) => a.due_date.localeCompare(b.due_date));
  const history = withState.filter((o) => o.status !== "open" && o.due_date <= ctx.today).concat(withState.filter((o) => o.status !== "open" && o.due_date > ctx.today));
  const nextScheduled = bill.status === "active" ? nextOccurrenceOnOrAfter(bill.anchor_date, bill.recurrence, ctx.today) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/bills" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ivory">
        <ChevronLeft size={16} aria-hidden /> My bills
      </Link>
      {sp.saved && <p role="status" className="rounded-xl border border-ok/30 bg-ok/5 p-3 text-sm text-ok">Saved. Billy&apos;s on it.</p>}

      <Card className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <CategoryIcon category={bill.category} className="h-14 w-14" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-extrabold break-words">{bill.name}</h1>
            <p className="text-muted">
              {CATEGORY_LABELS[bill.category as Category]} · {RECURRENCE_LABELS[bill.recurrence]}
              {bill.autopay ? (bill.autopay_account ? ` · Autopay from ${bill.autopay_account}` : " · Autopay") : ""}
              {bill.status === "archived" ? " · Archived" : ""}
            </p>
          </div>
          <Money minor={bill.amount_minor} currency={bill.currency} className="font-display text-2xl font-extrabold" />
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Next due</dt>
            <dd className="font-semibold">{nextScheduled ? `${formatDateLabel(nextScheduled, { month: "short", day: "numeric", year: "numeric" })} (${relativeDayLabel(nextScheduled, ctx.today)})` : "None"}</dd>
          </div>
          <div>
            <dt className="text-muted">Reminders</dt>
            <dd className="font-semibold">{!bill.reminders_enabled ? "Off" : bill.reminder_offsets ? bill.reminder_offsets.map((d) => (d === 0 ? "due day" : `${d}d before`)).join(", ") : "Your defaults"}</dd>
          </div>
          <div>
            <dt className="text-muted">Schedule anchor</dt>
            <dd className="font-semibold">{formatDateLabel(bill.anchor_date, { month: "short", day: "numeric", year: "numeric" })}</dd>
          </div>
        </dl>
        {bill.payment_url && (
          <a href={bill.payment_url} target="_blank" rel="noopener noreferrer nofollow" className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-line p-3 hover:bg-ivory/5">
            <span>
              <span className="block font-semibold">Pay on {hostnameOf(bill.payment_url)}</span>
              <span className="block text-sm text-muted">Payment happens on the provider&apos;s website. Come back to mark it paid.</span>
            </span>
            <ExternalLink size={18} aria-hidden />
          </a>
        )}
        {bill.notes && <p className="mt-4 whitespace-pre-wrap rounded-xl bg-bg p-3 text-sm">{bill.notes}</p>}
        <div className="mt-5">
          <BillManage billId={bill.id} name={bill.name} archived={bill.status === "archived"} openCount={open.length} />
        </div>
      </Card>

      <section>
        <SectionTitle>Unpaid</SectionTitle>
        {open.length === 0 ? (
          <Card className="p-5 text-muted">Nothing unpaid. Handled.</Card>
        ) : (
          <ul className="space-y-2">
            {open.map((o) => (
              <li key={o.id} id={`occ-${o.id}`} className={`flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border bg-panel p-4 ${sp.occurrence === o.id ? "border-lime" : "border-line"}`}>
                <div>
                  <div className="flex items-center gap-2">
                    <Money minor={o.amount_minor} currency={o.currency} className="font-bold" />
                    <StatusChip state={o.state} />
                  </div>
                  <p className={`text-sm ${o.state === "overdue" ? "text-peach" : "text-muted"}`}>
                    Due {formatDateLabel(o.due_date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })} · {relativeDayLabel(o.due_date, ctx.today)}
                    {o.due_overridden ? " · date changed for this cycle" : ""}
                  </p>
                  {o.planned_payment_date && <p className="text-xs text-muted">Plan: pay {formatDateLabel(o.planned_payment_date)}</p>}
                  {o.snoozed_until && new Date(o.snoozed_until) > new Date() && <p className="text-xs text-muted">Reminders snoozed until {new Date(o.snoozed_until).toLocaleString("en-CA", { timeZone: ctx.profile.time_zone, weekday: "short", hour: "numeric", minute: "2-digit" })}</p>}
                  {o.note && <p className="text-xs text-muted">Note: {o.note}</p>}
                </div>
                <OccurrenceActions
                  today={ctx.today}
                  occ={{ id: o.id, billId: bill.id, billName: bill.name, amountMinor: o.amount_minor, currency: o.currency, dueDate: o.due_date, status: o.status, autopay: bill.autopay, autopayAccount: bill.autopay_account, paymentUrl: bill.payment_url, paymentId: o.payment_id, plannedPaymentDate: o.planned_payment_date, note: o.note }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle>History</SectionTitle>
        {history.length === 0 ? (
          <Card className="p-5 text-muted">No paid or skipped cycles yet.</Card>
        ) : (
          <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-panel">
            {history.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold">
                    {formatDateLabel(o.due_date, { month: "long", day: "numeric", year: "numeric" })}
                    <span className="ml-2 align-middle">
                      <StatusChip state={o.state} />
                    </span>
                  </p>
                  <p className="text-sm text-muted">
                    {o.status === "paid" && o.paid_on ? (
                      <>
                        Paid <Money minor={o.paid_amount_minor ?? o.amount_minor} currency={o.currency} /> on {formatDateLabel(o.paid_on, { month: "short", day: "numeric", year: "numeric" })}
                      </>
                    ) : (
                      "Skipped"
                    )}
                  </p>
                </div>
                {o.status === "skipped" ? (
                  <UnskipButton occurrenceId={o.id} />
                ) : (
                  <OccurrenceActions
                    today={ctx.today}
                    occ={{ id: o.id, billId: bill.id, billName: bill.name, amountMinor: o.amount_minor, currency: o.currency, dueDate: o.due_date, status: o.status, autopay: bill.autopay, autopayAccount: bill.autopay_account, paymentUrl: bill.payment_url, paymentId: o.payment_id, plannedPaymentDate: null, note: o.note }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
