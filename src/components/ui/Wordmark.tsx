export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display font-extrabold tracking-tight text-ivory ${className}`} aria-label="Billy">
      billy<span className="text-lime" aria-hidden>*</span>
    </span>
  );
}
