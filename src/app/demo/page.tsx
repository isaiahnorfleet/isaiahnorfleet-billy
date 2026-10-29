import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, CalendarClock, CircleCheck, Sun } from "lucide-react";
import { BillyBanner } from "@/components/billy/BillyBanner";
import { BillyMascot } from "@/components/billy/BillyMascot";
import { StatCard } from "@/components/app/StatCard";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { LinkButton } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { Wordmark } from "@/components/ui/Wordmark";
import { dashboardMessage } from "@/lib/domain/billy-messages";
import { addDays, formatDateLabel, relativeDayLabel, todayIn } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { occurrenceState } from "@/lib/domain/status";
import { summarize } from "@/lib/domain/summary";

export const metadata: Metadata = { title: "Demo", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Demo mode: fictional sample bills, computed in memory. Never stored, never mixed with real data. */
export default function DemoPage() {
  const today = todayIn("America/Toronto");
  const sample = [
    { name: "Hydro (sample)", category: "utilities", amount: 11248, due: addDays(today, -4) },
    { name: "Rent (sample)", category: "housing", amount: 145000, due: addDays(today, 3) },
    { name: "Internet (sample)", category: "phone_internet", amount: 7999, due: addDays(today, 5) },
    { name: "Car insurance (sample)", category: "insurance", amount: 16420, due: addDays(today, 12) },
  ].map((s) => ({ ...s, state: occurrenceState("open", s.due, today) }));
  const summary = summarize(sample.map((s) => ({ status: "open" as const, due_date: s.due, amount_minor: s.amount, currency: "CAD" })), [], today);
  const message = dashboardMessage({
    tone: "straight",
    today,
    hasBills: true,
    overdue: sample.filter((s) => s.state === "overdue").map((s) => ({ name: "Hydro", dueDate: s.due, state: "overdue" as const })),
    dueToday: [],
    upcoming: [],
  });
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 pt-[calc(1rem+var(--safe-top))] pb-16 sm:px-6">
      <div role="note" className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 bg-amber px-4 py-2.5 text-sm font-semibold text-ink sm:-mx-6 sm:px-6">
        <span>Demo mode: these are made-up sample bills, not your data. Nothing here is saved.</span>
        <Link href="/sign-in" className="underline">
          Sign in to use Billy
        </Link>
      </div>
      <div className="flex items-center justify-between">
        <Wordmark className="text-4xl" />
        <LinkButton href="/sign-in">Get started</LinkButton>
      </div>
      <h1 className="font-display text-3xl font-extrabold sm:text-5xl">Hey there.</h1>
      <BillyBanner message={message} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Overdue" accent="peach" icon={<AlertCircle size={18} />} value={formatMoney(summary.overdue.totals.CAD ?? 0)} sub={`${summary.overdue.count} bill past due`} />
        <StatCard label="Due today" icon={<Sun size={18} />} value={formatMoney(summary.dueToday.totals.CAD ?? 0)} sub="0 bills" />
        <StatCard label="Next 7 days" icon={<CalendarClock size={18} />} value={formatMoney(summary.next7.totals.CAD ?? 0)} sub="After today. Excludes overdue." />
        <StatCard label="Paid this month" icon={<CircleCheck size={18} />} value={formatMoney(0)} sub="Confirmed payments" />
      </div>
      <ul className="space-y-2.5">
        {sample.map((s) => (
          <li key={s.name} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-panel p-4">
            <CategoryIcon category={s.category} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{s.name}</p>
              <p className={`text-sm ${s.state === "overdue" ? "text-peach" : "text-muted"}`}>
                {formatDateLabel(s.due)} · {relativeDayLabel(s.due, today)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="font-bold tabular">{formatMoney(s.amount)}</span>
              <StatusChip state={s.state} />
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-center gap-6 pt-6">
        {(["neutral", "heads_up", "due_today", "overdue", "celebrating", "all_clear"] as const).map((m) => (
          <BillyMascot key={m} mood={m} size={84} />
        ))}
      </div>
    </main>
  );
}
