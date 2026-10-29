import type { Metadata } from "next";
import { AlertCircle, CalendarClock, CircleCheck, Sun } from "lucide-react";
import { BillyBanner } from "@/components/billy/BillyBanner";
import { BillRow } from "@/components/app/BillRow";
import { StatCard } from "@/components/app/StatCard";
import { LinkButton } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { MoneyTotal } from "@/components/ui/Money";
import { BillyMascot } from "@/components/billy/BillyMascot";
import { pageContext, withFreshData } from "@/lib/server/context";
import { loadDashboard } from "@/lib/server/dashboard";
import { formatDateLabel } from "@/lib/domain/dates";
import { Plus } from "lucide-react";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage() {
  const ctx = await pageContext();
  const firstName = ctx.profile.display_name.split(" ")[0] || "there";
  const data = await withFreshData(ctx, (tx) => loadDashboard(tx, ctx.user.id, ctx.today, ctx.profile.tone, firstName));
  const { summary, items, message, focus } = data;
  const cur = ctx.profile.currency;
  const cta = focus && (focus.state === "overdue" || focus.state === "due_today") ? { href: `/bills/${focus.bill_id}?occurrence=${focus.id}`, label: "Let's handle it" } : undefined;
  const open = items.filter((i) => i.status === "open");
  const paid = items.filter((i) => i.status === "paid");
  const progress = summary.monthProgress;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold sm:text-5xl">Hey {firstName}.</h1>
          <p className="mt-1 text-muted sm:text-lg">A clear head starts with knowing what&apos;s due.</p>
        </div>
        <div className="hidden sm:block">
          <LinkButton href="/bills/new" size="lg">
            <Plus size={20} aria-hidden /> Add a bill
          </LinkButton>
        </div>
      </div>

      <BillyBanner message={message} cta={cta} />

      {data.hasBills && (
        <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Overdue"
            accent={summary.overdue.count > 0 ? "peach" : undefined}
            icon={<AlertCircle size={18} />}
            value={<MoneyTotal totals={summary.overdue.totals} currency={cur} />}
            sub={`${summary.overdue.count} ${summary.overdue.count === 1 ? "bill" : "bills"} past due`}
            href="/bills?filter=overdue"
          />
          <StatCard label="Due today" icon={<Sun size={18} />} value={<MoneyTotal totals={summary.dueToday.totals} currency={cur} />} sub={`${summary.dueToday.count} ${summary.dueToday.count === 1 ? "bill" : "bills"}`} href="/bills?filter=today" />
          <StatCard
            label="Next 7 days"
            icon={<CalendarClock size={18} />}
            value={<MoneyTotal totals={summary.next7.totals} currency={cur} />}
            sub="After today. Excludes overdue."
            href="/bills?filter=upcoming"
          />
          <StatCard
            label="Paid this month"
            icon={<CircleCheck size={18} />}
            value={<MoneyTotal totals={summary.paidThisMonth.totals} currency={cur} />}
            sub={progress.total > 0 ? `${progress.paid} of ${progress.total} bills due this month handled` : "Confirmed payments"}
            href="/history"
          />
        </section>
      )}

      {progress.total > 0 && (
        <div aria-label="Monthly progress">
          <div className="mb-1.5 flex justify-between text-sm text-muted">
            <span>{formatDateLabel(ctx.today, { month: "long" })} progress</span>
            <span className="tabular">
              {progress.paid}/{progress.total}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-panel" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.paid} aria-label="Bills handled this month">
            <div className="h-full rounded-full bg-lime transition-all" style={{ width: `${Math.round((progress.paid / progress.total) * 100)}%` }} />
          </div>
        </div>
      )}

      {!data.hasBills ? (
        <Card className="flex flex-col items-center p-8 text-center">
          <BillyMascot mood="heads_up" size={110} />
          <h2 className="mt-4 text-2xl font-bold">No bills yet</h2>
          <p className="mt-1 max-w-sm text-muted">Add your first bill and Billy will remind you before it&apos;s due, even when the app is closed.</p>
          <LinkButton href="/bills/new" size="lg" className="mt-5">
            <Plus size={20} aria-hidden /> Add a bill
          </LinkButton>
        </Card>
      ) : (
        <section>
          <SectionTitle>What needs attention</SectionTitle>
          {open.length === 0 ? (
            <Card className="p-6 text-center text-muted">Nothing due in the next 30 days.</Card>
          ) : (
            <ul className="space-y-2.5">
              {open.slice(0, 12).map((o) => (
                <BillRow
                  key={o.id}
                  state={o.state}
                  category={o.category}
                  recurrence={o.recurrence}
                  today={ctx.today}
                  occ={{
                    id: o.id,
                    billId: o.bill_id,
                    billName: o.bill_name,
                    amountMinor: o.amount_minor,
                    currency: o.currency,
                    dueDate: o.due_date,
                    status: o.status,
                    autopay: o.autopay,
                    paymentUrl: o.payment_url,
                    paymentId: o.payment_id,
                    plannedPaymentDate: o.planned_payment_date,
                    note: o.note,
                  }}
                />
              ))}
            </ul>
          )}
          {paid.length > 0 && (
            <>
              <h3 className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Handled this month</h3>
              <ul className="space-y-2.5">
                {paid.slice(0, 6).map((o) => (
                  <BillRow
                    key={o.id}
                    state="paid"
                    category={o.category}
                    recurrence={o.recurrence}
                    today={ctx.today}
                    paidOn={o.paid_on}
                    occ={{
                      id: o.id,
                      billId: o.bill_id,
                      billName: o.bill_name,
                      amountMinor: o.paid_amount_minor ?? o.amount_minor,
                      currency: o.currency,
                      dueDate: o.due_date,
                      status: o.status,
                      autopay: o.autopay,
                      paymentUrl: o.payment_url,
                      paymentId: o.payment_id,
                      plannedPaymentDate: null,
                      note: o.note,
                    }}
                  />
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <div className="fixed right-4 bottom-[calc(5.25rem+var(--safe-bottom))] z-30 sm:hidden">
        <LinkButton href="/bills/new" size="lg" className="shadow-xl">
          <Plus size={20} aria-hidden /> Add a bill
        </LinkButton>
      </div>
    </div>
  );
}
