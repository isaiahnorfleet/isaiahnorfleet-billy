import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { listOccurrencesInRange } from "@/lib/data/occurrences";
import { addDays, dayOfWeek, endOfMonth, formatDateLabel, formatLocalDate, isLocalDate, parseLocalDate, startOfMonth } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { occurrencesBetween, type Recurrence } from "@/lib/domain/recurrence";
import { occurrenceState, type OccurrenceState } from "@/lib/domain/status";
import { pageContext, withFreshData } from "@/lib/server/context";
import { Card } from "@/components/ui/Card";
import { StatusChip } from "@/components/ui/StatusChip";

export const metadata: Metadata = { title: "Calendar" };

interface CalItem {
  key: string;
  billId: string;
  occurrenceId: string | null;
  name: string;
  amountMinor: number;
  currency: string;
  date: string;
  state: OccurrenceState | "projected";
}

const DOT: Record<CalItem["state"], string> = {
  overdue: "bg-peach",
  due_today: "bg-amber",
  due_soon: "bg-amber",
  upcoming: "bg-ivory/70",
  projected: "border border-ivory/60",
  paid: "bg-ok",
  skipped: "bg-muted",
};

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; day?: string }> }) {
  const ctx = await pageContext();
  const sp = await searchParams;
  const monthStart = sp.month && /^\d{4}-\d{2}$/.test(sp.month) && isLocalDate(`${sp.month}-01`) ? `${sp.month}-01` : startOfMonth(ctx.today);
  const monthEnd = endOfMonth(monthStart);
  const gridStart = addDays(monthStart, -dayOfWeek(monthStart));
  const gridEnd = addDays(monthEnd, 6 - dayOfWeek(monthEnd));

  const { rows, bills } = await withFreshData(ctx, async (tx) => ({
    rows: await listOccurrencesInRange(tx, ctx.user.id, gridStart, gridEnd),
    bills: await tx<{ id: string; name: string; amount_minor: number; currency: string; recurrence: Recurrence; anchor_date: string; track_from: string }[]>`
      select id, name, amount_minor, currency, recurrence, anchor_date, track_from from bills where user_id = ${ctx.user.id} and status = 'active'`,
  }));

  const items: CalItem[] = rows.map((r) => ({
    key: r.id,
    billId: r.bill_id,
    occurrenceId: r.id,
    name: r.bill_name,
    amountMinor: r.status === "paid" ? (r.paid_amount_minor ?? r.amount_minor) : r.amount_minor,
    currency: r.currency,
    date: r.due_date,
    state: occurrenceState(r.status, r.due_date, ctx.today),
  }));
  // Future cycles that aren't stored yet are projected from each bill's schedule.
  const scheduledTaken = new Set(rows.map((r) => `${r.bill_id}:${r.scheduled_date}`));
  for (const b of bills) {
    for (const d of occurrencesBetween(b.anchor_date, b.recurrence, gridStart < b.track_from ? b.track_from : gridStart, gridEnd)) {
      if (d <= ctx.today || scheduledTaken.has(`${b.id}:${d}`)) continue;
      items.push({ key: `${b.id}:${d}`, billId: b.id, occurrenceId: null, name: b.name, amountMinor: b.amount_minor, currency: b.currency, date: d, state: "projected" });
    }
  }
  const byDay = new Map<string, CalItem[]>();
  for (const i of items) byDay.set(i.date, [...(byDay.get(i.date) ?? []), i]);

  const { y, m } = parseLocalDate(monthStart);
  const prev = formatLocalDate(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, 1).slice(0, 7);
  const next = formatLocalDate(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1).slice(0, 7);
  const days: string[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
  const selected = sp.day && isLocalDate(sp.day) ? sp.day : monthStart <= ctx.today && ctx.today <= monthEnd ? ctx.today : null;
  const selectedItems = selected ? (byDay.get(selected) ?? []) : [];
  const monthItems = items.filter((i) => i.date >= monthStart && i.date <= monthEnd).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold sm:text-4xl">{formatDateLabel(monthStart, { month: "long", year: "numeric" })}</h1>
        <div className="flex items-center gap-2">
          <Link href={`/calendar?month=${prev}`} className="flex h-10 w-10 items-center justify-center rounded-xl border border-line hover:bg-ivory/5" aria-label="Previous month">
            <ChevronLeft size={20} aria-hidden />
          </Link>
          <Link href="/calendar" className="flex h-10 items-center rounded-xl border border-line px-3 text-sm font-semibold hover:bg-ivory/5">
            Today
          </Link>
          <Link href={`/calendar?month=${next}`} className="flex h-10 w-10 items-center justify-center rounded-xl border border-line hover:bg-ivory/5" aria-label="Next month">
            <ChevronRight size={20} aria-hidden />
          </Link>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line text-center text-xs font-semibold text-muted" aria-hidden>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="py-2">
              <span className="sm:hidden">{d[0]}</span>
              <span className="hidden sm:inline">{d}</span>
            </div>
          ))}
        </div>
        <ol className="grid grid-cols-7">
          {days.map((d) => {
            const inMonth = d >= monthStart && d <= monthEnd;
            const list = byDay.get(d) ?? [];
            const isToday = d === ctx.today;
            const isSel = d === selected;
            const label = `${formatDateLabel(d, { weekday: "long", month: "long", day: "numeric" })}${list.length ? `, ${list.length} ${list.length === 1 ? "bill" : "bills"}` : ""}`;
            return (
              <li key={d} className={`min-h-16 border-r border-b border-line [&:nth-child(7n)]:border-r-0 sm:min-h-28 ${inMonth ? "" : "bg-bg/60"}`}>
                <Link
                  href={`/calendar?month=${monthStart.slice(0, 7)}&day=${d}`}
                  scroll={false}
                  aria-label={label}
                  aria-current={isToday ? "date" : undefined}
                  className={`flex h-full flex-col gap-1 p-1 sm:p-2 ${isSel ? "bg-lime/10 ring-2 ring-lime ring-inset" : "hover:bg-ivory/5"}`}
                >
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm tabular ${isToday ? "bg-lime font-bold text-ink" : inMonth ? "" : "text-muted"}`}>
                    {parseLocalDate(d).d}
                  </span>
                  <span className="flex flex-wrap gap-1 sm:hidden">
                    {list.slice(0, 4).map((i) => (
                      <span key={i.key} className={`h-2 w-2 rounded-full ${DOT[i.state]}`} />
                    ))}
                  </span>
                  <span className="hidden flex-col gap-1 sm:flex">
                    {list.slice(0, 3).map((i) => (
                      <span key={i.key} className="flex items-center gap-1 truncate text-xs">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[i.state]}`} />
                        <span className="truncate">{i.name}</span>
                      </span>
                    ))}
                    {list.length > 3 && <span className="text-xs text-muted">+{list.length - 3} more</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="flex flex-wrap gap-4 text-xs text-muted">
        {(
          [
            ["overdue", "Overdue"],
            ["due_soon", "Due soon / today"],
            ["upcoming", "Upcoming"],
            ["projected", "Scheduled (future cycle)"],
            ["paid", "Paid"],
          ] as const
        ).map(([k, l]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${DOT[k]}`} /> {l}
          </span>
        ))}
      </div>

      <section aria-live="polite">
        <h2 className="mb-3 text-lg font-bold">{selected ? formatDateLabel(selected, { weekday: "long", month: "long", day: "numeric" }) : "This month"}</h2>
        {(selected ? selectedItems : monthItems).length === 0 ? (
          <Card className="p-5 text-muted">Nothing due{selected ? " this day" : " this month"}.</Card>
        ) : (
          <ul className="space-y-2">
            {(selected ? selectedItems : monthItems).map((i) => (
              <li key={i.key}>
                <Link href={i.occurrenceId ? `/bills/${i.billId}?occurrence=${i.occurrenceId}` : `/bills/${i.billId}`} className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-panel p-4 hover:border-ivory/30">
                  <span>
                    <span className="block font-semibold">{i.name}</span>
                    <span className="block text-sm text-muted">{formatDateLabel(i.date, { weekday: "short", month: "short", day: "numeric" })}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className="font-bold tabular">{formatMoney(i.amountMinor, i.currency)}</span>
                    {i.state === "projected" ? <span className="text-xs text-muted">Scheduled</span> : <StatusChip state={i.state} />}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
