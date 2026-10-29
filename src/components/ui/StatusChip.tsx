import { STATE_LABELS, type OccurrenceState } from "@/lib/domain/status";

const styles: Record<OccurrenceState, { dot: string; chip: string }> = {
  overdue: { dot: "bg-peach", chip: "border-peach/40 text-peach" },
  due_today: { dot: "bg-amber", chip: "border-amber/50 text-amber" },
  due_soon: { dot: "bg-amber", chip: "border-amber/40 text-amber" },
  upcoming: { dot: "bg-muted", chip: "border-line text-muted" },
  paid: { dot: "bg-ok", chip: "border-ok/40 text-ok" },
  skipped: { dot: "bg-muted", chip: "border-line text-muted" },
};

export function StatusChip({ state, className = "" }: { state: OccurrenceState; className?: string }) {
  const s = styles[state];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.chip} ${className}`}>
      <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
      {STATE_LABELS[state]}
    </span>
  );
}
