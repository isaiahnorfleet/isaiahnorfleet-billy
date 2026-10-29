import type { ComponentProps, ReactNode } from "react";

const control =
  "w-full rounded-[var(--radius-control)] border border-line bg-bg px-3.5 h-12 text-ivory placeholder:text-muted/70 focus:border-lime focus:outline-none aria-[invalid=true]:border-peach";

export function Field({ label, hint, error, htmlFor, children }: { label: string; hint?: ReactNode; error?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-ivory">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm text-peach" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ invalid, className = "", ...props }: ComponentProps<"input"> & { invalid?: boolean }) {
  return <input aria-invalid={invalid || undefined} className={`${control} ${className}`} {...props} />;
}

export function Select({ invalid, className = "", ...props }: ComponentProps<"select"> & { invalid?: boolean }) {
  return <select aria-invalid={invalid || undefined} className={`${control} appearance-none bg-[length:16px] pr-9 ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: ComponentProps<"textarea">) {
  return <textarea className={`${control} h-auto min-h-24 py-3 ${className}`} {...props} />;
}

export function Toggle({ name, label, description, defaultChecked, disabled }: { name: string; label: string; description?: ReactNode; defaultChecked?: boolean; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block font-semibold">{label}</span>
        {description && <span className="block text-sm text-muted">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled} className="peer sr-only" />
        <span className="h-7 w-12 rounded-full border border-line bg-bg transition-colors peer-checked:border-lime peer-checked:bg-lime peer-focus-visible:shadow-[var(--shadow-focus)] peer-disabled:opacity-50" />
        <span className="pointer-events-none absolute left-1 top-1 h-5 w-5 rounded-full bg-muted transition-transform peer-checked:translate-x-5 peer-checked:bg-ink" />
      </span>
    </label>
  );
}
