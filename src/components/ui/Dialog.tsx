"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Accessible modal built on the native <dialog> element (focus trapping, Escape to close).
 * On phones it renders as a bottom sheet; on larger screens, a centered panel.
 */
export function Dialog({ open, onClose, title, children, labelledBy }: { open: boolean; onClose: () => void; title: string; children: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const id = labelledBy ?? `dlg-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-0 mt-auto w-full max-w-none rounded-t-[1.5rem] border border-line bg-panel p-0 text-ivory sm:m-auto sm:max-w-md sm:rounded-[var(--radius-card)]"
    >
      <div className="max-h-[85dvh] overflow-y-auto p-5 pb-[calc(1.25rem+var(--safe-bottom))]">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={id} className="text-xl font-bold">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="-m-2 rounded-full p-2 text-muted hover:text-ivory" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
