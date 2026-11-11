"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  addStarterCategoriesAction,
  deleteCategoryAction,
  deleteGoalAction,
  deleteExpenseAction,
  deleteIncomeAction,
  saveCategoryAction,
  saveExpenseAction,
  saveGoalAction,
  saveIncomeAction,
  setAutoLimitsAction,
} from "@/app/actions/budget";
import type { ActionResult } from "@/app/actions/result";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { Money } from "@/components/ui/Money";
import { useToast } from "@/components/ui/Toast";
import { formatDateLabel } from "@/lib/domain/dates";
import { minorToInput } from "@/lib/domain/money";
import { RECURRENCE_LABELS, RECURRENCES, type Recurrence } from "@/lib/domain/recurrence";

export interface CategoryOption {
  id: string;
  name: string;
}

/** Runs a server action, then toasts and refreshes. Returns field errors for the form. */
function useSubmit() {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<ActionResult>, success: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast({ title: res.error, tone: "error" });
        return;
      }
      setErrors({});
      after?.();
      toast({ title: success, mood: "neutral" });
      router.refresh();
    });
  return { pending, errors, setErrors, run };
}

function ConfirmDelete({ label, pending, onConfirm }: { label: string; pending: boolean; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <div className="flex gap-2">
      <Button variant="danger" className="flex-1" disabled={pending} onClick={onConfirm}>
        Yes, remove
      </Button>
      <Button variant="ghost" onClick={() => setArmed(false)}>
        Keep it
      </Button>
    </div>
  ) : (
    <Button variant="ghost" className="w-full !text-peach" onClick={() => setArmed(true)}>
      {label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Spending
// ---------------------------------------------------------------------------

export interface ExpenseValue {
  id: string;
  amount_minor: number;
  category_id: string | null;
  spent_on: string;
  note: string | null;
}

function ExpenseDialog({
  open,
  onClose,
  categories,
  today,
  currency,
  expense,
  defaultCategoryId,
}: {
  open: boolean;
  onClose: () => void;
  categories: CategoryOption[];
  today: string;
  currency: string;
  expense?: ExpenseValue;
  defaultCategoryId?: string | null;
}) {
  const [amount, setAmount] = useState(expense ? minorToInput(expense.amount_minor, currency) : "");
  const [categoryId, setCategoryId] = useState<string | null>(expense ? expense.category_id : (defaultCategoryId ?? null));
  const [date, setDate] = useState(expense?.spent_on ?? today);
  const [note, setNote] = useState(expense?.note ?? "");
  const { pending, errors, run } = useSubmit();
  const reset = () => {
    if (expense) return;
    setAmount("");
    setNote("");
    setDate(today);
  };
  const idp = expense?.id ?? "new";
  return (
    <Dialog open={open} onClose={onClose} title={expense ? "Edit spending" : "Log spending"}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveExpenseAction({ id: expense?.id, amount, category_id: categoryId, spent_on: date, note }), expense ? "Spending updated" : "Spending logged", () => {
            reset();
            onClose();
          });
        }}
      >
        <Field label="Amount" htmlFor={`exp-amt-${idp}`} error={errors.amount}>
          <Input
            id={`exp-amt-${idp}`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            invalid={!!errors.amount}
            className="tabular text-xl font-bold"
          />
        </Field>
        {categories.length > 0 && (
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold">Category</legend>
            <div className="flex flex-wrap gap-2">
              {[...categories, { id: "", name: "No category" }].map((c) => {
                const selected = (categoryId ?? "") === c.id;
                return (
                  <button
                    key={c.id || "none"}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setCategoryId(c.id || null)}
                    className={`min-h-10 rounded-full border px-3.5 text-sm font-semibold transition-colors ${selected ? "border-lime bg-lime text-ink" : "border-line text-ivory hover:bg-ivory/5"}`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        <Field label="Date" htmlFor={`exp-date-${idp}`} error={errors.spent_on}>
          <Input id={`exp-date-${idp}`} type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} invalid={!!errors.spent_on} />
        </Field>
        <Field label="Note (optional)" htmlFor={`exp-note-${idp}`} error={errors.note}>
          <Input id={`exp-note-${idp}`} value={note} maxLength={200} placeholder="e.g. Costco run" onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {expense ? "Save changes" : "Log it"}
        </Button>
        {expense && (
          <ConfirmDelete label="Remove this entry" pending={pending} onConfirm={() => run(() => deleteExpenseAction(expense.id), "Entry removed", onClose)} />
        )}
      </form>
    </Dialog>
  );
}

export function LogSpendingButton({
  categories,
  today,
  currency,
  defaultCategoryId,
  label = "Log spending",
  size = "md",
  className = "",
}: {
  categories: CategoryOption[];
  today: string;
  currency: string;
  defaultCategoryId?: string | null;
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} className={className} onClick={() => setOpen(true)}>
        <Plus size={size === "sm" ? 16 : 20} aria-hidden /> {label}
      </Button>
      <ExpenseDialog open={open} onClose={() => setOpen(false)} categories={categories} today={today} currency={currency} defaultCategoryId={defaultCategoryId} />
    </>
  );
}

export function ExpenseItem({ expense, categoryName, categories, today, currency }: { expense: ExpenseValue; categoryName: string | null; categories: CategoryOption[]; today: string; currency: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-3 p-4 text-left hover:bg-ivory/5" data-testid="expense-row">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{expense.note || categoryName || "Spending"}</p>
          <p className="text-sm text-muted">
            {formatDateLabel(expense.spent_on, { weekday: "short", month: "short", day: "numeric" })}
            {expense.note && categoryName ? ` · ${categoryName}` : ""}
          </p>
        </div>
        <Money minor={expense.amount_minor} currency={currency} className="font-bold" />
      </button>
      <ExpenseDialog open={open} onClose={() => setOpen(false)} categories={categories} today={today} currency={currency} expense={expense} />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export function CategoryButton({
  category,
  currency,
  autoLimits = false,
  children,
  className = "",
}: {
  category?: { id: string; name: string; limit_minor: number | null };
  currency: string;
  autoLimits?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(category?.name ?? "");
  const [limit, setLimit] = useState(category?.limit_minor != null ? minorToInput(category.limit_minor, currency) : "");
  const { pending, errors, run } = useSubmit();
  const idp = category?.id ?? "new";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={category ? `Edit ${category.name}` : "New category"}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveCategoryAction({ id: category?.id, name, limit }), category ? "Category updated" : "Category added", () => {
              if (!category) {
                setName("");
                setLimit("");
              }
              setOpen(false);
            });
          }}
        >
          <Field label="Name" htmlFor={`cat-name-${idp}`} error={errors.name}>
            <Input id={`cat-name-${idp}`} value={name} maxLength={40} placeholder="e.g. Groceries" onChange={(e) => setName(e.target.value)} invalid={!!errors.name} />
          </Field>
          <Field label="Monthly limit" htmlFor={`cat-limit-${idp}`} error={errors.limit} hint={autoLimits ? "Leave blank and Billy sets it each month. Enter an amount to fix it yourself." : "Leave blank to just track what you spend."}>
            <Input id={`cat-limit-${idp}`} inputMode="decimal" value={limit} placeholder="e.g. 400" onChange={(e) => setLimit(e.target.value)} invalid={!!errors.limit} className="tabular" />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {category ? "Save changes" : "Add category"}
          </Button>
          {category && (
            <ConfirmDelete
              label="Remove this category"
              pending={pending}
              onConfirm={() => run(() => deleteCategoryAction(category.id), "Category removed. Its spending is now uncategorized.", () => setOpen(false))}
            />
          )}
        </form>
      </Dialog>
    </>
  );
}

export function StarterCategoriesButton() {
  const { pending, run } = useSubmit();
  return (
    <Button variant="secondary" disabled={pending} onClick={() => run(() => addStarterCategoriesAction(), "Starter categories added")}>
      Use starter categories
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------

export interface IncomeValue {
  id: string;
  name: string;
  amount_minor: number;
  recurrence: Recurrence;
  anchor_date: string;
}

export function IncomeButton({ income, currency, today, children, className = "" }: { income?: IncomeValue; currency: string; today: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(income?.name ?? "");
  const [amount, setAmount] = useState(income ? minorToInput(income.amount_minor, currency) : "");
  const [recurrence, setRecurrence] = useState<Recurrence>(income?.recurrence ?? "biweekly");
  const [anchor, setAnchor] = useState(income?.anchor_date ?? today);
  const { pending, errors, run } = useSubmit();
  const idp = income?.id ?? "new";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={income ? `Edit ${income.name}` : "Add income"}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveIncomeAction({ id: income?.id, name, amount, recurrence, anchor_date: anchor }), income ? "Income updated" : "Income added", () => {
              if (!income) {
                setName("");
                setAmount("");
              }
              setOpen(false);
            });
          }}
        >
          <Field label="Name" htmlFor={`inc-name-${idp}`} error={errors.name}>
            <Input id={`inc-name-${idp}`} value={name} maxLength={80} placeholder="e.g. Paycheque" onChange={(e) => setName(e.target.value)} invalid={!!errors.name} />
          </Field>
          <Field label="Amount each time (after tax)" htmlFor={`inc-amt-${idp}`} error={errors.amount}>
            <Input id={`inc-amt-${idp}`} inputMode="decimal" value={amount} placeholder="0.00" onChange={(e) => setAmount(e.target.value)} invalid={!!errors.amount} className="tabular" />
          </Field>
          <Field label="How often" htmlFor={`inc-rec-${idp}`}>
            <Select id={`inc-rec-${idp}`} value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
              {RECURRENCES.map((r) => (
                <option key={r} value={r}>
                  {RECURRENCE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={recurrence === "once" ? "Date" : "A pay date"}
            htmlFor={`inc-date-${idp}`}
            error={errors.anchor_date}
            hint={recurrence === "once" ? undefined : "Any real pay date works, like your last or next one. Billy counts the rest from it."}
          >
            <Input id={`inc-date-${idp}`} type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} invalid={!!errors.anchor_date} />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {income ? "Save changes" : "Add income"}
          </Button>
          {income && <ConfirmDelete label="Remove this income" pending={pending} onConfirm={() => run(() => deleteIncomeAction(income.id), "Income removed", () => setOpen(false))} />}
        </form>
      </Dialog>
    </>
  );
}


// ---------------------------------------------------------------------------
// Plan: goals and auto limits
// ---------------------------------------------------------------------------

export interface GoalValue {
  id: string;
  name: string;
  amount_minor: number | null;
  percent_bp: number | null;
  target_minor: number | null;
  balance_minor: number;
  annual_return_bp: number;
}

const INVESTING = /invest|rrsp|tfsa|fhsa|resp|stock|etf|retire/i;

export function GoalButton({ goal, presetName, currency, children, className = "" }: { goal?: GoalValue; presetName?: string; currency: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(goal?.name ?? presetName ?? "");
  const [mode, setMode] = useState<"amount" | "percent">(goal ? (goal.percent_bp !== null ? "percent" : "amount") : "percent");
  const [value, setValue] = useState(
    goal ? (goal.percent_bp !== null ? String(goal.percent_bp / 100) : minorToInput(goal.amount_minor ?? 0, currency)) : "",
  );
  const [target, setTarget] = useState(goal?.target_minor ? minorToInput(goal.target_minor, currency) : "");
  const [balance, setBalance] = useState(goal?.balance_minor ? minorToInput(goal.balance_minor, currency) : "");
  const [ret, setRet] = useState(goal ? (goal.annual_return_bp ? String(goal.annual_return_bp / 100) : "") : presetName && INVESTING.test(presetName) ? "5" : "");
  const [more, setMore] = useState(!!goal && (goal.target_minor !== null || goal.balance_minor > 0 || goal.annual_return_bp > 0));
  const { pending, errors, run } = useSubmit();
  const idp = goal?.id ?? `new-${presetName ?? "custom"}`;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={goal ? `Edit ${goal.name}` : presetName ? `Add ${presetName.toLowerCase()}` : "Add a goal"}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveGoalAction({ id: goal?.id, name, mode, value, target, balance, annual_return: ret }), goal ? "Goal updated" : "Goal added", () => {
              if (!goal) setValue("");
              setOpen(false);
            });
          }}
        >
          <Field label="Name" htmlFor={`goal-name-${idp}`} error={errors.name}>
            <Input id={`goal-name-${idp}`} value={name} maxLength={40} placeholder="e.g. Vacation fund" onChange={(e) => setName(e.target.value)} invalid={!!errors.name} />
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold">How much each month</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["percent", "amount"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={`min-h-11 rounded-[var(--radius-control)] border text-sm font-semibold ${mode === m ? "border-lime bg-lime text-ink" : "border-line text-ivory hover:bg-ivory/5"}`}
                >
                  {m === "percent" ? "% of income" : "Fixed amount"}
                </button>
              ))}
            </div>
          </fieldset>
          <Field
            label={mode === "percent" ? "Percent of income" : "Amount per month"}
            htmlFor={`goal-value-${idp}`}
            error={errors.value}
            hint={mode === "percent" ? "Grows with months that have an extra payday." : undefined}
          >
            <Input
              id={`goal-value-${idp}`}
              inputMode="decimal"
              value={value}
              placeholder={mode === "percent" ? "e.g. 10" : "e.g. 200"}
              onChange={(e) => setValue(e.target.value)}
              invalid={!!errors.value}
              className="tabular"
            />
          </Field>
          {more || errors.target || errors.balance || errors.annual_return ? (
            <div className="space-y-4 rounded-[var(--radius-control)] border border-line p-3.5">
              <p className="text-sm text-muted">For the projection chart. All optional.</p>
              <Field label="Target" htmlFor={`goal-target-${idp}`} error={errors.target} hint="What you're aiming for, like 10000.">
                <Input id={`goal-target-${idp}`} inputMode="decimal" value={target} placeholder="e.g. 10000" onChange={(e) => setTarget(e.target.value)} invalid={!!errors.target} className="tabular" />
              </Field>
              <Field label="Already saved" htmlFor={`goal-balance-${idp}`} error={errors.balance}>
                <Input id={`goal-balance-${idp}`} inputMode="decimal" value={balance} placeholder="0" onChange={(e) => setBalance(e.target.value)} invalid={!!errors.balance} className="tabular" />
              </Field>
              <Field
                label="Interest / return (% per year)"
                htmlFor={`goal-return-${idp}`}
                error={errors.annual_return}
                hint="Compounded monthly. Use your savings account's rate (e.g. 3.5), or for investing a long-term guess like 5. Blank means 0%."
              >
                <Input id={`goal-return-${idp}`} inputMode="decimal" value={ret} placeholder="0" onChange={(e) => setRet(e.target.value)} invalid={!!errors.annual_return} className="tabular" />
              </Field>
            </div>
          ) : (
            <button type="button" className="text-sm font-semibold text-lime underline" onClick={() => setMore(true)}>
              Add a target, interest, and see when you&apos;ll reach it
            </button>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {goal ? "Save changes" : "Add goal"}
          </Button>
          {goal && <ConfirmDelete label="Remove this goal" pending={pending} onConfirm={() => run(() => deleteGoalAction(goal.id), "Goal removed", () => setOpen(false))} />}
        </form>
      </Dialog>
    </>
  );
}

export function AutoLimitsToggle({ on }: { on: boolean }) {
  const { pending, run } = useSubmit();
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block font-semibold">Let Billy set my category limits</span>
        <span className="block text-sm text-muted">Each month, Billy splits your spending money across categories, based on what you usually spend. Limits you type in yourself stay fixed.</span>
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={on}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked;
            run(() => setAutoLimitsAction(next), next ? "Billy is planning your limits" : "Back to your own limits");
          }}
          data-testid="auto-limits"
        />
        <span className="h-7 w-12 rounded-full border border-line bg-bg transition-colors peer-checked:border-lime peer-checked:bg-lime peer-focus-visible:shadow-[var(--shadow-focus)] peer-disabled:opacity-50" />
        <span className="pointer-events-none absolute left-1 top-1 h-5 w-5 rounded-full bg-muted transition-transform peer-checked:translate-x-5 peer-checked:bg-ink" />
      </span>
    </label>
  );
}
