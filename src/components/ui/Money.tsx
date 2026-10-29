import { formatMoney, formatTotals, type MoneyTotals } from "@/lib/domain/money";

export function Money({ minor, currency, className = "" }: { minor: number; currency: string; className?: string }) {
  return <span className={`tabular ${className}`}>{formatMoney(minor, currency)}</span>;
}

export function MoneyTotal({ totals, currency, className = "" }: { totals: MoneyTotals; currency: string; className?: string }) {
  return <span className={`tabular ${className}`}>{formatTotals(totals, currency)}</span>;
}
