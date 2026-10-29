/** Shown instantly on navigation while the next page loads on the server. */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-9 w-48 animate-pulse rounded-xl bg-panel motion-reduce:animate-none" />
      <div className="h-4 w-64 animate-pulse rounded-lg bg-panel motion-reduce:animate-none" />
      <div className="space-y-3 pt-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-[var(--radius-card)] bg-panel motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  );
}
