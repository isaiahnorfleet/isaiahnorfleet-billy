import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export function StatCard({ label, value, sub, icon, href, accent }: { label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; href?: string; accent?: "peach" | "lime" }) {
  const inner = (
    <>
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className={accent === "peach" ? "text-peach" : "text-lime"} aria-hidden>
          {icon}
        </span>
        <span className={accent === "peach" ? "font-semibold text-peach" : ""}>{label}</span>
      </div>
      <div className="mt-1.5 font-display text-2xl font-extrabold tabular sm:text-3xl">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
      {href && <ChevronRight size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />}
    </>
  );
  const cls = "relative block rounded-[var(--radius-card)] border border-line bg-panel p-4 pr-8";
  return href ? (
    <Link href={href} className={`${cls} hover:border-ivory/30`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
