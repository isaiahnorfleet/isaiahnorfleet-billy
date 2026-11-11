import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";
import { BillyBanner } from "@/components/billy/BillyBanner";
import { CategoryButton, ExpenseItem, IncomeButton, LogSpendingButton, StarterCategoriesButton } from "@/components/app/BudgetForms";
import { Card, SectionTitle } from "@/components/ui/Card";
import { Money } from "@/components/ui/Money";
import { listBillsForMonth, listCategories, listExpenses, listIncomeSources } from "@/lib/data/budget";
import { budgetMessage } from "@/lib/domain/budget-messages";
import { budgetState, computeBudget, parseMonthParam, shiftMonth, type CategoryLine } from "@/lib/domain/budget";
import { endOfMonth, formatDateLabel } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { RECURRENCE_LABELS } from "@/lib/domain/recurrence";
import { pageContext, withFreshData } from "@/lib/server/context";

export const metadata: Metadata = { title: "Budget" };

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await pageContext();
  const sp = await searchParams;
  const month = parseMonthParam(sp.month, ctx.today);
  const cur = ctx.profile.currency;

  const { incomes, categories, expenses, bills } = await withFreshData(ctx, async (tx) => ({
    incomes: await listIncomeSources(tx, ctx.user.id),
    categories: await listCategories(tx, ctx.user.id),
    expenses: await listExpenses(tx, ctx.user.id, month, endOfMonth(month)),
    bills: await listBillsForMonth(tx, ctx.user.id, month),
  }));

  const s = computeBudget({ month, today: ctx.today, currency: cur, incomes, bills, categories, expenses });
  const { state, categoryName } = budgetState(s, ctx.today);
  const money = (m: number) => formatMoney(m, cur);
  const message = budgetMessage(state, ctx.profile.tone, `${month}:${state}`, {
    category: categoryName,
    left: money(Math.abs(s.left_minor)),
    perDay: money(s.perDay_minor ?? 0),
  });

  const catOptions = categories.map((c) => ({ id: c.id, name: c.name }));
  const prev = shiftMonth(month, -1).slice(0, 7);
  const next = shiftMonth(month, 1).slice(0, 7);
  const monthLabel = formatDateLabel(month, { month: "long", year: "numeric" });
  const isNow = s.timing === "current";
  const leftLabel = s.timing === "past" ? "Left over" : s.timing === "future" ? "Left after bills" : "Left to spend";

  return (
    <div className="space-y-6 pb-16 sm:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold sm:text-4xl">Budget</h1>
          <p className="text-muted">{monthLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/budget?month=${prev}`} className="flex h-10 w-10 items-center justify-center rounded-xl border border-line hover:bg-ivory/5" aria-label="Previous month">
            <ChevronLeft size={20} aria-hidden />
          </Link>
          {!isNow && (
            <Link href="/budget" className="flex h-10 items-center rounded-xl border border-line px-3 text-sm font-semibold hover:bg-ivory/5">
              This month
            </Link>
          )}
          <Link href={`/budget?month=${next}`} className="flex h-10 w-10 items-center justify-center rounded-xl border border-line hover:bg-ivory/5" aria-label="Next month">
            <ChevronRight size={20} aria-hidden />
          </Link>
          {/* One button: floating above the tab bar on phones, inline in the header on larger screens. */}
          <div className="fixed right-4 bottom-[calc(5.25rem+var(--safe-bottom))] z-30 sm:static sm:ml-2">
            <LogSpendingButton categories={catOptions} today={ctx.today} currency={cur} className="h-13 px-6 shadow-xl sm:h-11 sm:px-4 sm:shadow-none" />
          </div>
        </div>
      </div>

      <BillyBanner message={message} />

      {/* The number that matters */}
      <Card className="p-5 sm:p-6" aria-label="Month summary">
        <p className="text-sm font-semibold text-muted">{leftLabel}</p>
        <p className={`mt-1 font-display text-4xl font-extrabold tabular sm:text-5xl ${s.left_minor < 0 ? "text-peach" : "text-lime"}`} data-testid="left-to-spend">
          {s.left_minor < 0 ? `−${money(-s.left_minor)}` : money(s.left_minor)}
        </p>
        {isNow && s.perDay_minor !== null && s.daysLeft !== null && (
          <p className="mt-1 text-sm text-muted">
            About <span className="font-semibold text-ivory">{money(s.perDay_minor)}</span> a day for the next {s.daysLeft} {s.daysLeft === 1 ? "day" : "days"}
          </p>
        )}
        {s.left_minor < 0 && <p className="mt-1 text-sm text-peach">Over by {money(-s.left_minor)} this month.</p>}
        <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-line pt-4 text-sm">
          <div>
            <dt className="text-muted">Income</dt>
            <dd className="font-bold tabular">{money(s.income.total_minor)}</dd>
          </div>
          <div>
            <dt className="text-muted">Bills</dt>
            <dd className="font-bold tabular">−{money(s.bills.total_minor)}</dd>
          </div>
          <div>
            <dt className="text-muted">Spending</dt>
            <dd className="font-bold tabular">−{money(s.spent_minor)}</dd>
          </div>
        </dl>
      </Card>

      {/* Categories */}
      <section aria-labelledby="cat-title">
        <SectionTitle
          action={
            categories.length > 0 ? (
              <CategoryButton currency={cur} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-semibold hover:bg-ivory/5">
                <Plus size={16} aria-hidden /> Category
              </CategoryButton>
            ) : undefined
          }
        >
          <span id="cat-title">Spending categories</span>
        </SectionTitle>
        {categories.length === 0 ? (
          <Card className="p-5 text-center">
            <p className="text-muted">Categories give your spending limits, like $500 for groceries. Start with a few common ones, or make your own.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <StarterCategoriesButton />
              <CategoryButton currency={cur} className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-control)] px-4 font-semibold text-ivory hover:bg-ivory/5">
                <Plus size={18} aria-hidden /> Make my own
              </CategoryButton>
            </div>
          </Card>
        ) : (
          <>
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {s.categories.map((c) => (
                <CategoryCard key={c.id ?? "uncategorized"} line={c} currency={cur} />
              ))}
            </ul>
            {s.hasIncome && (
              <p className="mt-3 text-sm text-muted">
                {s.planned_minor === 0
                  ? "No limits set yet. Tap a category to give it one."
                  : s.unassigned_minor >= 0
                    ? `Limits add up to ${money(s.planned_minor)}, leaving ${money(s.unassigned_minor)} after bills that isn't assigned to a category.`
                    : `Limits add up to ${money(s.planned_minor)}, which is ${money(-s.unassigned_minor)} more than you have after bills.`}
              </p>
            )}
          </>
        )}
      </section>

      {/* Income */}
      <section aria-labelledby="income-title">
        <SectionTitle
          action={
            <IncomeButton currency={cur} today={ctx.today} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-semibold hover:bg-ivory/5">
              <Plus size={16} aria-hidden /> Income
            </IncomeButton>
          }
        >
          <span id="income-title">Income</span>
        </SectionTitle>
        {incomes.length === 0 ? (
          <Card className="p-5 text-center text-muted">Add your paycheque or any other money that comes in. Billy works out how many paydays land in each month.</Card>
        ) : (
          <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-panel">
            {s.income.lines.map((l) => {
              const src = incomes.find((i) => i.id === l.id)!;
              return (
                <li key={l.id}>
                  <IncomeButton income={src} currency={cur} today={ctx.today} className="flex w-full items-center gap-3 p-4 text-left hover:bg-ivory/5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{l.name}</span>
                      <span className="block text-sm text-muted">
                        {money(l.amount_minor)} · {RECURRENCE_LABELS[l.recurrence].toLowerCase()}
                        {l.dates.length > 0 ? ` · ${l.dates.map((d) => formatDateLabel(d, { month: "short", day: "numeric" })).join(", ")}` : " · none this month"}
                      </span>
                    </span>
                    <Money minor={l.total_minor} currency={cur} className="font-bold" />
                    <Pencil size={16} className="text-muted" aria-hidden />
                  </IncomeButton>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Bills */}
      <section aria-labelledby="bills-title">
        <SectionTitle>
          <span id="bills-title">Bills this month</span>
        </SectionTitle>
        <Link href={`/calendar?month=${month.slice(0, 7)}`} className="relative block rounded-[var(--radius-card)] border border-line bg-panel p-4 pr-10 hover:border-ivory/30">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-semibold">
              {s.bills.count} {s.bills.count === 1 ? "bill" : "bills"}
            </span>
            <Money minor={s.bills.total_minor} currency={cur} className="font-bold" />
          </div>
          {s.bills.total_minor > 0 && (
            <>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg" aria-hidden>
                <div className="h-full rounded-full bg-ok" style={{ width: `${Math.round((s.bills.paid_minor / s.bills.total_minor) * 100)}%` }} />
              </div>
              <p className="mt-2 text-sm text-muted">
                {money(s.bills.paid_minor)} paid · {money(s.bills.unpaid_minor)} still to pay
              </p>
            </>
          )}
          <ChevronRight size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        </Link>
      </section>

      {/* Spending log */}
      <section aria-labelledby="spend-title">
        <SectionTitle>
          <span id="spend-title">Spending in {formatDateLabel(month, { month: "long" })}</span>
        </SectionTitle>
        {expenses.length === 0 ? (
          <Card className="p-5 text-center text-muted">{s.timing === "future" ? "Nothing yet. This month hasn't started." : "Nothing logged yet. Tap Log spending when you buy something."}</Card>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel">
            {expenses.map((e) => (
              <ExpenseItem
                key={e.id}
                expense={{ id: e.id, amount_minor: e.amount_minor, category_id: e.category_id, spent_on: e.spent_on, note: e.note }}
                categoryName={e.category_name}
                categories={catOptions}
                today={ctx.today}
                currency={cur}
              />
            ))}
          </ul>
        )}
      </section>

      {s.otherCurrencyCount > 0 && (
        <p className="text-sm text-muted">
          {s.otherCurrencyCount} {s.otherCurrencyCount === 1 ? "item uses" : "items use"} a currency other than {cur} and {s.otherCurrencyCount === 1 ? "isn't" : "aren't"} counted here.
        </p>
      )}

    </div>
  );
}

function CategoryCard({ line, currency }: { line: CategoryLine; currency: string }) {
  const money = (m: number) => formatMoney(m, currency);
  const pct = line.used === null ? null : Math.min(100, Math.round(line.used * 100));
  const bar = line.over ? "bg-peach" : line.used !== null && line.used >= 0.85 ? "bg-amber" : "bg-lime";
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate font-semibold">{line.name}</span>
        <span className="shrink-0 text-sm tabular">
          <span className="font-bold">{money(line.spent_minor)}</span>
          {line.limit_minor !== null && <span className="text-muted"> / {money(line.limit_minor)}</span>}
        </span>
      </div>
      {pct !== null && (
        <div
          className="mt-2.5 h-2 overflow-hidden rounded-full bg-bg"
          role="progressbar"
          aria-label={`${line.name} limit used`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className={`mt-1.5 text-xs ${line.over ? "font-semibold text-peach" : "text-muted"}`}>
        {line.remaining_minor === null ? (line.id ? "No limit · tap to set one" : "Spending without a category") : line.over ? `${money(-line.remaining_minor)} over` : `${money(line.remaining_minor)} left`}
      </p>
    </>
  );
  return (
    <li className="rounded-[var(--radius-card)] border border-line bg-panel" data-testid="budget-category">
      {line.id ? (
        <CategoryButton category={{ id: line.id, name: line.name, limit_minor: line.limit_minor }} currency={currency} className="block w-full p-4 text-left hover:bg-ivory/5">
          {body}
        </CategoryButton>
      ) : (
        <div className="p-4">{body}</div>
      )}
    </li>
  );
}
