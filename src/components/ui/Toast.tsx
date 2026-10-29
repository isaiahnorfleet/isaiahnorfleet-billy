"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { BillyMascot } from "@/components/billy/BillyMascot";
import type { Mood } from "@/lib/domain/billy-messages";

interface ToastItem {
  id: number;
  title: string;
  body?: string;
  mood?: Mood;
  tone?: "default" | "error";
  action?: { label: string; onClick: () => void | Promise<void> };
  durationMs?: number;
}

const ToastContext = createContext<(t: Omit<ToastItem, "id">) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = nextId.current++;
    setItems((cur) => [...cur.slice(-2), { ...t, id }]);
  }, []);
  const dismiss = useCallback((id: number) => setItems((cur) => cur.filter((t) => t.id !== id)), []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+var(--safe-bottom))] z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6" aria-live="polite" role="status">
        {items.map((t) => (
          <ToastView key={t.id} item={t} onDone={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ item, onDone }: { item: ToastItem; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const timer = setTimeout(onDone, item.durationMs ?? (item.action ? 8000 : 4500));
    return () => clearTimeout(timer);
  }, [item, onDone]);
  return (
    <div
      className={`animate-pop pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border p-3 shadow-2xl ${
        item.tone === "error" ? "border-peach/60 bg-[#2a1f1b]" : "border-line bg-panel-2"
      }`}
    >
      {item.mood && <BillyMascot mood={item.mood} size={40} decorative />}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{item.title}</p>
        {item.body && <p className="text-sm text-muted">{item.body}</p>}
      </div>
      {item.action && (
        <button
          type="button"
          disabled={busy}
          className="rounded-xl px-3 py-2 text-sm font-bold text-lime hover:bg-lime/10 disabled:opacity-50"
          onClick={async () => {
            setBusy(true);
            await item.action!.onClick();
            onDone();
          }}
        >
          {item.action.label}
        </button>
      )}
    </div>
  );
}
