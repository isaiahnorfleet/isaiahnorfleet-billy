import type { Metadata } from "next";
import Link from "next/link";
import { Download, Search } from "lucide-react";
import { listPayments } from "@/lib/data/payments";
import { addToTotals, type MoneyTotals } from "@/lib/domain/money";
import { formatDateLabel, isLocalDate } from "@/lib/domain/dates";
import { pageContext, withFreshData } from "@/lib/server/context";
import { PaymentActions } from "@/components/app/PaymentActions";
import { BillyMascot } from "@/components/billy/BillyMascot";
import { Card } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { Money, MoneyTotal } from "@/components/ui/Money";

export const metadata: Metadata = { title: "Payment history" };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageContext();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const billId = sp.bill && /^[0-9a-f-]{36}$/i.test(sp.bill) ? sp.bill : undefined;
  const from = sp.from && isLocalDate(sp.from) ? sp.from : undefined;
  const to = sp.to && isLocalDate(sp.to) ? sp.to : undefined;
  const showVoided = sp.voided === "1";
  const { payments, bills } = await withFreshData(ctx, async (tx) => ({
    payments: await listPayments(tx, ctx.user.id, { q, billId, from, to, includeVoided: showVoided }),
    bills: await tx<{ id: string; name: string }[]>`select id, name from bills where user_id = ${ctx.user.id} order by name`,
  }));
  const totals: MoneyTotals = {};
  for (const p of payments) if (!p.voided_at) addToTotals(totals, p.currency, p.amount_minor);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold sm:text-4xl">Payment history</h1>
          <p className="text-muted">A record of the bills you&apos;ve confirmed paid.</p>
        </div>
        <a href="/api/export?format=csv" className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold hover:bg-ivory/5">
          <Download size={16} aria-hidden /> Export CSV
        </a>
      </div>

      <form method="get" role="search" className="grid gap-2 sm:grid-cols-[1fr_200px_150px_150px_auto]">
        <label className="relative">
          <span className="sr-only">Search payments</span>
          <Search size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" aria-hidden />
          <Input name="q" defaultValue={q} placeholder="Search bill or note" className="pl-10" />
        </label>
        <label>
          <span className="sr-only">Bill</span>
          <Select name="bill" defaultValue={billId ?? ""}>
            <option value="">All bills</option>
            {bills.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="sr-only">From date</span>
          <Input type="date" name="from" defaultValue={from} aria-label="From" />
        </label>
        <label>
          <span className="sr-only">To date</span>
          <Input type="date" name="to" defaultValue={to} aria-label="To" />
        </label>
        <button type="submit" className="h-12 rounded-[var(--radius-control)] border border-line px-4 font-semibold hover:bg-ivory/5">
          Filter
        </button>
        <label className="flex items-center gap-2 text-sm text-muted sm:col-span-5">
          <input type="checkbox" name="voided" value="1" defaultChecked={showVoided} className="h-4 w-4 accent-[var(--color-lime)]" />
          Show undone and corrected entries
        </label>
      </form>

      {payments.length === 0 ? (
        <Card className="flex flex-col items-center p-8 text-center">
          <BillyMascot mood="neutral" size={90} />
          <p className="mt-3 text-muted">{q || billId || from || to ? "No payments match." : "No payments yet. When you mark a bill paid, it shows up here."}</p>
          {(q || billId || from || to) && (
            <Link href="/history" className="mt-2 text-lime underline">
              Clear filters
            </Link>
          )}
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted">
            {payments.filter((p) => !p.voided_at).length} payments · <MoneyTotal totals={totals} currency={ctx.profile.currency} className="font-semibold text-ivory" />
          </p>
          <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-panel">
            {payments.map((p) => (
              <li key={p.id} className={`flex items-center gap-3 p-4 ${p.voided_at ? "opacity-60" : ""}`} data-testid="payment-row">
                <div className="min-w-0 flex-1">
                  <Link href={`/bills/${p.bill_id}`} className="font-semibold hover:underline">
                    {p.bill_name}
                  </Link>
                  <p className="text-sm text-muted">
                    Paid {formatDateLabel(p.paid_on, { month: "short", day: "numeric", year: "numeric" })} · for the {formatDateLabel(p.due_date, { month: "short", day: "numeric" })} bill
                    {p.note ? ` · ${p.note}` : ""}
                  </p>
                  {p.voided_at && <p className="text-xs text-peach">{p.void_reason === "corrected" ? "Corrected (replaced by a newer entry)" : "Undone"}</p>}
                </div>
                <Money minor={p.amount_minor} currency={p.currency} className={`font-bold ${p.voided_at ? "line-through" : ""}`} />
                {!p.voided_at && <PaymentActions id={p.id} billName={p.bill_name} amountMinor={p.amount_minor} currency={p.currency} paidOn={p.paid_on} note={p.note} today={ctx.today} />}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
