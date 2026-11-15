"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock3, Delete, Keyboard, Plus, Sparkles } from "lucide-react";
import { deleteExpenseAction, quickAddDataAction, quickLogAction, type QuickAddData } from "@/app/actions/budget";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { addDays, formatDateLabel } from "@/lib/domain/dates";
import { formatMoney, minorDigits, minorToInput, parseAmountToMinor } from "@/lib/domain/money";
import { buildMemory, categoryForNote, parseEntry, sortCategoriesByUse, timeOfDaySuggestions, type Suggestion } from "@/lib/domain/quick-add";

/** Any button on the page can open the sheet with `openQuickAdd()`. */
const OPEN_EVENT = "billy:quick-add";
export function openQuickAdd() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

type Mode = "keypad" | "type";
const MODE_KEY = "billy.quickAdd.mode";

function readMode(): Mode {
  try {
    return window.localStorage.getItem(MODE_KEY) === "type" ? "type" : "keypad";
  } catch {
    return "keypad";
  }
}

function saveMode(mode: Mode) {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Private mode or blocked storage: the sheet just opens on the keypad next time.
  }
}

/**
 * The floating "+" on every screen. Opens a sheet to log spending in a couple of taps: type the
 * amount on a keypad and tap a category, or type one line like "23.50 groceries Metro".
 */
export function QuickAdd() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<QuickAddData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    const res = await quickAddDataAction();
    loading.current = false;
    if (res.ok) {
      setData(res.data);
      setLoadError(false);
    } else setLoadError(true);
  }, []);

  const show = useCallback(() => {
    setOpen(true);
    load();
  }, [load]);

  useEffect(() => {
    const onOpen = () => show();
    window.addEventListener(OPEN_EVENT, onOpen);
    // Warm up suggestions shortly after the page settles, so the sheet opens ready.
    const t = setTimeout(load, 1500);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      clearTimeout(t);
    };
  }, [load, show]);

  // Tuck the + away while scrolling down so it never sits on a card's buttons. It comes back on
  // scroll up, near the top or at the end of the page (which leaves room for it), and once
  // scrolling stops, as long as no button or link is underneath where it would be.
  const [tucked, setTucked] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let last = window.scrollY;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const coversControl = () => {
      const r = fabRef.current?.getBoundingClientRect();
      if (!r) return false;
      // Where the button sits when shown (it slides down a little while tucked).
      const shift = fabRef.current!.classList.contains("translate-y-6") ? 24 : 0;
      const points: [number, number][] = [
        [r.left + r.width / 2, r.top - shift + r.height / 2],
        [r.left + 6, r.top - shift + 6],
        [r.right - 6, r.top - shift + 6],
        [r.left + 6, r.bottom - shift - 6],
        [r.right - 6, r.bottom - shift - 6],
      ];
      return points.some(([x, y]) =>
        document.elementsFromPoint(x, y).some((el) => el !== fabRef.current && !fabRef.current!.contains(el) && el.closest("a,button,input,select,textarea,[role=button]")),
      );
    };
    const onScroll = () => {
      const y = window.scrollY;
      const atEnd = y + window.innerHeight >= document.documentElement.scrollHeight - 24;
      if (y < 80 || atEnd || y < last - 4) setTucked(false);
      else if (y > last + 4) setTucked(true);
      last = y;
      clearTimeout(idle);
      idle = setTimeout(() => {
        if (!coversControl()) setTucked(false);
      }, 700);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(idle);
    };
  }, []);

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        onClick={show}
        onFocus={() => setTucked(false)}
        aria-label="Log spending"
        data-testid="quick-add-fab"
        className={`fixed right-4 bottom-[calc(5.25rem+var(--safe-bottom))] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-lime text-ink shadow-[0_10px_30px_rgba(0,0,0,0.45)] transition-[transform,opacity] duration-200 hover:bg-lime-press active:scale-95 lg:right-8 lg:bottom-8 ${
          tucked ? "pointer-events-none translate-y-6 opacity-0" : ""
        }`}
      >
        <Plus size={28} strokeWidth={2.6} aria-hidden />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Log spending">
        {open && <QuickAddSheet data={data} loadError={loadError} onRetry={load} onDone={() => { setOpen(false); load(); }} />}
      </Dialog>
    </>
  );
}

function QuickAddSheet({ data, loadError, onRetry, onDone }: { data: QuickAddData | null; loadError: boolean; onRetry: () => void; onDone: () => void }) {
  // Only rendered once the sheet opens (in the browser), so reading storage here is safe.
  const [mode, setMode] = useState<Mode>(readMode);
  const switchMode = (m: Mode) => {
    setMode(m);
    saveMode(m);
  };

  const currency = data?.currency ?? "CAD";
  const today = data?.today ?? null;
  const memory = useMemo(() => buildMemory(data?.past ?? []), [data]);
  const categories = useMemo(() => sortCategoriesByUse(data?.categories ?? [], data?.past ?? []), [data]);
  const suggestions = useMemo(() => (data ? timeOfDaySuggestions(data.past, data.minuteNow) : []), [data]);
  const nameOf = (id: string | null) => (id ? (categories.find((c) => c.id === id)?.name ?? null) : null);

  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const log = (entry: { amount_minor: number; category_id: string | null; note: string | null; spent_on: string }) => {
    if (pending) return;
    start(async () => {
      const res = await quickLogAction({
        amount: minorToInput(entry.amount_minor, currency),
        category_id: entry.category_id,
        spent_on: entry.spent_on,
        note: entry.note ?? "",
      });
      if (!res.ok) {
        toast({ title: res.error, tone: "error" });
        return;
      }
      const label = [formatMoney(entry.amount_minor, currency), nameOf(entry.category_id) ?? entry.note].filter(Boolean).join(" · ");
      toast({
        title: `Logged ${label}`,
        mood: "neutral",
        action: {
          label: "Undo",
          onClick: async () => {
            const undo = await deleteExpenseAction(res.id);
            if (undo.ok) router.refresh();
            else toast({ title: undo.error, tone: "error" });
          },
        },
      });
      onDone();
      router.refresh();
    });
  };

  if (!data) {
    return (
      <div className="py-8 text-center text-muted" aria-busy={!loadError}>
        {loadError ? (
          <>
            <p>Couldn&apos;t load your categories.</p>
            <button type="button" onClick={onRetry} className="mt-3 rounded-xl border border-line px-4 py-2 font-semibold text-ivory hover:bg-ivory/5">
              Try again
            </button>
          </>
        ) : (
          <p>Getting your categories…</p>
        )}
      </div>
    );
  }

  const toggle = (
      <div className="flex shrink-0 rounded-xl border border-line p-0.5 text-sm font-semibold" role="group" aria-label="How to enter it">
        {(
          [
            ["keypad", "Keypad"],
            ["type", "Type it"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => switchMode(m)}
            className={`flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 transition-colors ${mode === m ? "bg-ivory/10 text-ivory" : "text-muted hover:text-ivory"}`}
          >
            {m === "type" && <Keyboard size={14} aria-hidden />}
            {label}
          </button>
        ))}
      </div>
  );

  return (
    <div className="space-y-4">
      {mode === "keypad" ? (
        <KeypadMode
          toggle={toggle}
          categories={categories}
          suggestions={suggestions}
          memory={memory}
          today={today!}
          currency={currency}
          pending={pending}
          nameOf={nameOf}
          onLog={log}
        />
      ) : (
        <TypeMode toggle={toggle} categories={categories} memory={memory} today={today!} currency={currency} pending={pending} nameOf={nameOf} onLog={log} />
      )}
      {categories.length === 0 && (
        <p className="text-center text-sm text-muted">
          Tip: add categories on the{" "}
          <Link href="/budget" className="font-semibold text-lime underline-offset-2 hover:underline">
            Budget tab
          </Link>{" "}
          so Billy can sort your spending.
        </p>
      )}
    </div>
  );
}

type LogFn = (entry: { amount_minor: number; category_id: string | null; note: string | null; spent_on: string }) => void;

interface ModeProps {
  toggle: ReactNode;
  categories: { id: string; name: string }[];
  memory: ReturnType<typeof buildMemory>;
  today: string;
  currency: string;
  pending: boolean;
  nameOf: (id: string | null) => string | null;
  onLog: LogFn;
}

function DateChips({ today, value, onChange }: { today: string; value: string; onChange: (d: string) => void }) {
  const yesterday = addDays(today, -1);
  const other = value !== today && value !== yesterday;
  const chip = (active: boolean) => `h-8 rounded-full border px-3 text-xs font-semibold transition-colors ${active ? "border-ivory/70 bg-ivory/10 text-ivory" : "border-line text-muted hover:text-ivory"}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="When">
      <button type="button" aria-pressed={value === today} className={chip(value === today)} onClick={() => onChange(today)}>
        Today
      </button>
      <button type="button" aria-pressed={value === yesterday} className={chip(value === yesterday)} onClick={() => onChange(yesterday)}>
        Yesterday
      </button>
      <label className={`${chip(other)} relative inline-flex cursor-pointer items-center`}>
        {other ? formatDateLabel(value, { weekday: "short", month: "short", day: "numeric" }) : "Other day"}
        <input
          type="date"
          aria-label="Pick a date"
          max={today}
          value={value}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

function KeypadMode({ toggle, categories, suggestions, memory, today, currency, pending, nameOf, onLog }: ModeProps & { suggestions: Suggestion[] }) {
  const [digits, setDigits] = useState("");
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<string | null | undefined>(undefined); // undefined = let Billy pick
  const [date, setDate] = useState(today);
  const decimals = minorDigits(currency);

  const amount = digits === "" ? null : parseAmountToMinor(digits, currency);
  const guess = note.trim() ? categoryForNote(note, categories, memory) : null;
  const categoryId = picked !== undefined ? picked : (guess?.id ?? null);

  const press = useCallback(
    (key: string) => {
      setDigits((d) => {
        if (key === "back") return d.slice(0, -1);
        if (key === ".") return decimals === 0 || d.includes(".") ? d : d === "" ? "0." : `${d}.`;
        const [whole, frac] = d.split(".");
        if (frac !== undefined && frac.length >= decimals) return d;
        if (frac === undefined && whole.length >= 7) return d;
        if (d === "0") return key;
        return d + key;
      });
    },
    [decimals],
  );

  const submit = (category: string | null) => {
    if (amount === null || amount <= 0) return;
    onLog({ amount_minor: amount, category_id: category, note: note.trim() || null, spent_on: date });
  };

  // Physical keyboards: digits, ".", Backspace and Enter work while the store field isn't focused.
  const submitRef = useRef(submit);
  const categoryRef = useRef(categoryId);
  useEffect(() => {
    submitRef.current = submit;
    categoryRef.current = categoryId;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "." || e.key === ",") press(".");
      else if (e.key === "Backspace") press("back");
      else if (e.key === "Enter") {
        e.preventDefault();
        submitRef.current(categoryRef.current);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  // Show exactly what was typed ("$23.5"), with the currency symbol in front.
  const symbol = formatMoney(0, currency).replace(/[\d.,\s\u00a0]/g, "");
  const [whole, frac] = (digits === "" ? "0" : digits).split(".");
  const display = `${symbol}${whole.replace(/\B(?=(\d{3})+$)/g, ",")}${frac !== undefined ? `.${frac}` : ""}`;
  const ready = amount !== null && amount > 0;
  const key = "flex h-11 items-center justify-center rounded-xl bg-ivory/[0.06] text-xl font-bold tabular active:bg-ivory/15 hover:bg-ivory/10";

  return (
    <div className="space-y-3">
      <div className="-mt-1 flex items-center justify-between gap-3">
        <p className={`min-w-0 truncate font-display text-4xl font-extrabold tabular ${ready ? "text-ivory" : "text-muted/60"}`} aria-live="polite" data-testid="quick-amount">
          {display}
        </p>
        {toggle}
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={200}
        placeholder="Store or note (optional)"
        aria-label="Store or note"
        autoComplete="off"
        enterKeyHint="done"
        className="h-11 w-full rounded-[var(--radius-control)] border border-line bg-bg px-3.5 text-ivory placeholder:text-muted focus:border-lime focus:outline-none"
      />

      {suggestions.length > 0 && (
        <div>
          <div className="-mx-5 flex items-center gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]" role="group" aria-label="Usual around now">
            <Clock3 size={16} className="shrink-0 text-muted" aria-label="Usual around now" />
            {suggestions.map((s) => (
              <button
                key={s.note}
                type="button"
                onClick={() => {
                  setDigits(minorToInput(s.amount_minor, currency).replace(/\.00$/, ""));
                  setNote(s.note);
                  setPicked(s.category_id);
                }}
                className="shrink-0 rounded-xl border border-line px-3 py-1.5 text-left text-sm whitespace-nowrap hover:bg-ivory/5"
              >
                <span className="font-semibold">{s.note}</span>
                <span className="text-muted"> · {formatMoney(s.amount_minor, currency)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs font-semibold text-muted">{ready ? "Tap a category to log it" : "Category"}</p>
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
          {[...categories, { id: "", name: "No category" }].map((c) => {
            const id = c.id || null;
            const selected = categoryId === id && (picked !== undefined || guess !== null);
            const billyPick = picked === undefined && guess !== null && guess.id === id;
            return (
              <button
                key={c.id || "none"}
                type="button"
                disabled={pending}
                aria-pressed={selected}
                onClick={() => {
                  setPicked(id);
                  if (ready) submit(id);
                }}
                className={`inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap transition-colors disabled:opacity-60 ${
                  selected ? "border-lime bg-lime text-ink" : "border-line text-ivory hover:bg-ivory/5"
                }`}
              >
                {billyPick && <Sparkles size={13} aria-label="Billy's pick" />}
                {c.name}
              </button>
            );
          })}
        </div>
      </div>

      <DateChips today={today} value={date} onChange={setDate} />

      <div className="grid grid-cols-4 gap-2" aria-label="Amount keypad">
        {["1", "2", "3"].map((k) => (
          <button key={k} type="button" className={key} onClick={() => press(k)}>
            {k}
          </button>
        ))}
        <button type="button" className={key} onClick={() => press("back")} aria-label="Delete last digit">
          <Delete size={22} aria-hidden />
        </button>
        {["4", "5", "6"].map((k) => (
          <button key={k} type="button" className={key} onClick={() => press(k)}>
            {k}
          </button>
        ))}
        <button
          type="button"
          disabled={!ready || pending}
          onClick={() => submit(categoryId)}
          className="row-span-3 flex flex-col items-center justify-center gap-0.5 rounded-xl bg-lime px-1 text-ink font-bold hover:bg-lime-press disabled:opacity-40"
          data-testid="quick-log"
        >
          <span className="text-lg">Log</span>
          {nameOf(categoryId) && <span className="max-w-full truncate text-[11px] font-semibold opacity-80">{nameOf(categoryId)}</span>}
        </button>
        {["7", "8", "9"].map((k) => (
          <button key={k} type="button" className={key} onClick={() => press(k)}>
            {k}
          </button>
        ))}
        {decimals > 0 ? (
          <button type="button" className={key} onClick={() => press(".")} aria-label="Decimal point">
            .
          </button>
        ) : (
          <span />
        )}
        <button type="button" className={`${key} col-span-2`} onClick={() => press("0")}>
          0
        </button>
      </div>
    </div>
  );
}

function TypeMode({ toggle, categories, memory, today, currency, pending, nameOf, onLog }: ModeProps) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => parseEntry(text, { categories, memory, today, currency }), [text, categories, memory, today, currency]);
  const ready = parsed.amount_minor !== null && parsed.amount_minor > 0;
  const catName = nameOf(parsed.category_id);
  const submit = () => {
    if (!ready) return;
    onLog({ amount_minor: parsed.amount_minor!, category_id: parsed.category_id, note: parsed.note, spent_on: parsed.spent_on });
  };
  const dayLabel = parsed.spent_on === today ? "Today" : parsed.spent_on === addDays(today, -1) ? "Yesterday" : formatDateLabel(parsed.spent_on, { weekday: "short", month: "short", day: "numeric" });

  return (
    <form
      className="space-y-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="-mt-1 flex justify-end">{toggle}</div>
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="23.50 groceries Metro"
        aria-label="What did you spend?"
        aria-describedby="quick-type-preview"
        autoComplete="off"
        autoCapitalize="sentences"
        enterKeyHint="send"
        maxLength={220}
        className="h-14 w-full rounded-[var(--radius-control)] border border-line bg-bg px-4 text-lg font-semibold text-ivory placeholder:font-normal placeholder:text-muted focus:border-lime focus:outline-none"
        data-testid="quick-text"
      />
      <div id="quick-type-preview" className="min-h-[4.5rem] rounded-xl border border-dashed border-line p-3 text-sm" aria-live="polite">
        {text.trim() === "" ? (
          <p className="text-muted">
            Type the amount, then anything else in any order: a category, the store, or a day like <em>yesterday</em>. For example <em>12 coffee Tim Hortons</em> or{" "}
            <em>60 gas Esso friday</em>.
          </p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" data-testid="quick-preview">
            <dt className="text-muted">Amount</dt>
            <dd className={`font-bold tabular ${ready ? "" : "text-peach"}`}>{ready ? formatMoney(parsed.amount_minor!, currency) : "Add an amount, like 23.50"}</dd>
            <dt className="text-muted">Category</dt>
            <dd className="font-semibold">
              {catName ?? <span className="font-normal text-muted">None</span>}
              {parsed.category_source === "remembered" && <span className="ml-1.5 text-xs font-normal text-muted">(like last time)</span>}
              {parsed.category_source === "store" && <span className="ml-1.5 text-xs font-normal text-muted">(Billy&apos;s guess)</span>}
            </dd>
            {parsed.note && (
              <>
                <dt className="text-muted">Note</dt>
                <dd className="truncate">{parsed.note}</dd>
              </>
            )}
            <dt className="text-muted">When</dt>
            <dd>{dayLabel}</dd>
          </dl>
        )}
      </div>
      <button
        type="submit"
        disabled={!ready || pending}
        className="flex h-13 w-full items-center justify-center rounded-[var(--radius-control)] bg-lime text-base font-bold text-ink hover:bg-lime-press disabled:opacity-40"
      >
        {ready ? `Log ${formatMoney(parsed.amount_minor!, currency)}${catName ? ` · ${catName}` : ""}` : "Log it"}
      </button>
    </form>
  );
}
