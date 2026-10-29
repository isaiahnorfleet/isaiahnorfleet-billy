import Link from "next/link";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { StatusChip } from "@/components/ui/StatusChip";
import { Money } from "@/components/ui/Money";
import { CATEGORY_LABELS, type Category } from "@/lib/domain/categories";
import { formatDateLabel, relativeDayLabel } from "@/lib/domain/dates";
import { RECURRENCE_LABELS, type Recurrence } from "@/lib/domain/recurrence";
import type { OccurrenceState } from "@/lib/domain/status";
import { OccurrenceActions, type OccurrenceSummary } from "./OccurrenceActions";

export function dueText(state: OccurrenceState, dueDate: string, today: string, paidOn?: string | null): string {
  const date = formatDateLabel(dueDate, { month: "short", day: "numeric", year: dueDate.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric" });
  if (state === "paid") return paidOn ? `Paid ${formatDateLabel(paidOn)}` : "Paid";
  if (state === "overdue") return `Was due ${date} · ${relativeDayLabel(dueDate, today)}`;
  if (state === "due_today") return `Due today`;
  return `Due ${date} · ${relativeDayLabel(dueDate, today)}`;
}

export function BillRow({
  occ,
  state,
  category,
  recurrence,
  today,
  paidOn,
}: {
  occ: OccurrenceSummary;
  state: OccurrenceState;
  category: string;
  recurrence: Recurrence;
  today: string;
  paidOn?: string | null;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-panel p-3.5 sm:flex-row sm:items-center sm:gap-4 sm:p-4" data-testid="bill-row">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <CategoryIcon category={category} />
        <div className="min-w-0 flex-1">
          <Link href={`/bills/${occ.billId}`} className="block truncate font-semibold hover:underline">
            {occ.billName}
          </Link>
          <p className="truncate text-sm text-muted">
            {CATEGORY_LABELS[category as Category] ?? "Other"} · {RECURRENCE_LABELS[recurrence]}
            {occ.autopay ? (occ.autopayAccount ? ` · Autopay from ${occ.autopayAccount}` : " · Autopay") : ""}
          </p>
        </div>
        <div className="text-right">
          <Money minor={occ.amountMinor} currency={occ.currency} className="block font-bold" />
          <span className="mt-1 inline-block sm:hidden">
            <StatusChip state={state} />
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 sm:w-auto sm:justify-end">
        <div className="text-sm sm:w-52 sm:text-right">
          <span className="hidden sm:mb-1 sm:inline-block">
            <StatusChip state={state} />
          </span>
          <p className={state === "overdue" ? "text-peach" : "text-muted"}>{dueText(state, occ.dueDate, today, paidOn)}</p>
          {occ.plannedPaymentDate && state !== "paid" && <p className="text-xs text-muted">Plan: pay {formatDateLabel(occ.plannedPaymentDate)}</p>}
        </div>
        <OccurrenceActions occ={occ} today={today} />
      </div>
    </li>
  );
}
