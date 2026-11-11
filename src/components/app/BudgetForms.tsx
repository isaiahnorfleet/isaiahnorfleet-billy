"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  addStarterCategoriesAction,
  deleteCategoryAction,
  deleteExpenseAction,
  deleteIncomeAction,
  saveCategoryAction,
  saveExpenseAction,
  saveIncomeAction,
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

export function CategoryButton({ category, currency, children, className = "" }: { category?: { id: string; name: string; limit_minor: number | null }; currency: string; children: ReactNode; className?: string }) {
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
          <Field label="Monthly limit" htmlFor={`cat-limit-${idp}`} error={errors.limit} hint="Leave blank to just track what you spend.">
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

