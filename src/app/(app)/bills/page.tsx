import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { listBills, type BillListRow } from "@/lib/data/bills";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/domain/categories";
import { addDays, formatDateLabel, relativeDayLabel, startOfMonth } from "@/lib/domain/dates";
import { RECURRENCE_LABELS } from "@/lib/domain/recurrence";
import { occurrenceState } from "@/lib/domain/status";
import { pageContext, withFreshData } from "@/lib/server/context";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { Money } from "@/components/ui/Money";
import { StatusChip } from "@/components/ui/StatusChip";
import { BillyMascot } from "@/components/billy/BillyMascot";

export const metadata: Metadata = { title: "My bills" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "paid", label: "Paid this month" },
  { key: "archived", label: "Archived" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

function matches(b: BillListRow, f: FilterKey, today: string): boolean {
  if (f === "archived") return b.status === "archived";
  if (b.status === "archived") return false;
  switch (f) {
    case "overdue":
      return b.overdue_count > 0;
    case "today":
      return b.next_due_date === today;
    case "upcoming":
      return b.next_due_date !== null && b.next_due_date > today && b.next_due_date <= addDays(today, 30);
    case "paid":
      return b.last_paid_on !== null && b.last_paid_on >= startOfMonth(today);
    default:
      return true;
  }
}

export default async function BillsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageContext();
  const sp = await searchParams;
  const filter = (FILTERS.find((f) => f.key === sp.filter)?.key ?? "all") as FilterKey;
  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 80);
  const category = CATEGORIES.includes(sp.category as Category) ? (sp.category as Category) : "";
  const sort = sp.sort === "amount" ? "amount" : sp.sort === "name" ? "name" : "due";

  const all = await withFreshData(ctx, (tx) => listBills(tx, ctx.user.id, ctx.today));
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, all.filter((b) => matches(b, f.key, ctx.today)).length]));
  let bills = all.filter((b) => matches(b, filter, ctx.today));
  if (q) bills = bills.filter((b) => b.name.toLowerCase().includes(q) || (b.notes ?? "").toLowerCase().includes(q));
  if (category) bills = bills.filter((b) => b.category === category);
  bills.sort((a, b) => {
    if (sort === "amount") return (b.next_amount_minor ?? b.amount_minor) - (a.next_amount_minor ?? a.amount_minor);
    if (sort === "name") return a.name.localeCompare(b.name);
    const da = a.oldest_overdue_date ?? a.next_due_date ?? "9999";
    const db = b.oldest_overdue_date ?? b.next_due_date ?? "9999";
    return da.localeCompare(db);
  });

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({ ...(filter !== "all" ? { filter } : {}), ...(q ? { q } : {}), ...(category ? { category } : {}), ...(sort !== "due" ? { sort } : {}), ...over });
    for (const [k, v] of [...p.entries()]) if (!v || (k === "filter" && v === "all")) p.delete(k);
    const s = p.toString();
    return s ? `/bills?${s}` : "/bills";
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold sm:text-4xl">My bills</h1>
          <p className="text-muted">Add, edit or archive your bills.</p>
        </div>
        <LinkButton href="/bills/new">
          <Plus size={18} aria-hidden /> Add a bill
        </LinkButton>
      </div>

      <nav aria-label="Filter bills" className="-mx-4 overflow-x-auto px-4">
        <ul className="flex w-max gap-2">
          {FILTERS.map((f) => (
            <li key={f.key}>
              <Link
                href={qs({ filter: f.key })}
                aria-current={filter === f.key ? "true" : undefined}
                className={`inline-flex h-9 items-center rounded-full border px-3.5 text-sm font-semibold ${filter === f.key ? "border-lime bg-lime text-ink" : "border-line text-ivory hover:border-ivory/40"}`}
              >
                {f.label} ({counts[f.key]})
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <form method="get" className="grid gap-2 sm:grid-cols-[1fr_200px_170px_auto]" role="search">
        {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
        <label className="relative">
          <span className="sr-only">Search bills</span>
          <Search size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" aria-hidden />
          <Input name="q" defaultValue={q} placeholder="Search bills" className="pl-10" />
        </label>
        <label>
          <span className="sr-only">Category</span>
          <Select name="category" defaultValue={category}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="sr-only">Sort</span>
          <Select name="sort" defaultValue={sort}>
            <option value="due">Sort: due date</option>
            <option value="amount">Sort: amount</option>
            <option value="name">Sort: name</option>
          </Select>
        </label>
        <button type="submit" className="h-12 rounded-[var(--radius-control)] border border-line px-4 font-semibold hover:bg-ivory/5">
          Apply
        </button>
      </form>

      {all.length === 0 ? (
        <Card className="flex flex-col items-center p-8 text-center">
          <BillyMascot mood="heads_up" size={100} />
          <h2 className="mt-3 text-xl font-bold">No bills yet</h2>
          <p className="mt-1 text-muted">Add one and Billy takes it from there.</p>
          <LinkButton href="/bills/new" className="mt-4">
            <Plus size={18} aria-hidden /> Add a bill
          </LinkButton>
        </Card>
      ) : bills.length === 0 ? (
        <Card className="p-6 text-center text-muted">No bills match these filters. <Link href="/bills" className="text-lime underline">Clear filters</Link></Card>
      ) : (
        <ul className="space-y-2.5">
          {bills.map((b) => {
            const focusDate = b.oldest_overdue_date ?? b.next_due_date;
            const state = b.status === "archived" ? null : b.oldest_overdue_date ? "overdue" : b.next_due_date ? occurrenceState("open", b.next_due_date, ctx.today) : null;
            return (
              <li key={b.id}>
                <Link href={`/bills/${b.id}`} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-panel p-3.5 hover:border-ivory/30 sm:p-4" data-testid="bills-list-row">
                  <CategoryIcon category={b.category} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{b.name}</p>
                    <p className="truncate text-sm text-muted">
                      {CATEGORY_LABELS[b.category as Category]} · {RECURRENCE_LABELS[b.recurrence]}
                      {b.overdue_count > 1 ? ` · ${b.overdue_count} unpaid cycles` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <Money minor={b.next_amount_minor ?? b.amount_minor} currency={b.currency} className="block font-bold" />
                    {b.status === "archived" ? (
                      <span className="text-sm text-muted">Archived</span>
                    ) : state && focusDate ? (
                      <span className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                        <StatusChip state={state} />
                        <span className={`text-xs ${state === "overdue" ? "text-peach" : "text-muted"}`}>
                          {formatDateLabel(focusDate)} · {relativeDayLabel(focusDate, ctx.today)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-sm text-muted">No upcoming date</span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
