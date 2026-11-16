"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Baby, BookOpen, Car, ChevronDown, Coffee, Dumbbell, Film, Fuel, Gift, GraduationCap, HeartPulse, House, Music, PartyPopper, PawPrint, Pill, Pizza,
  Plane, Receipt, Scissors, Shirt, ShoppingBag, ShoppingCart, Smartphone, Sparkles, Train, Tv, Utensils, Wine, Wrench, Zap, type LucideIcon,
} from "lucide-react";
import { AnimatedBilly } from "@/components/billy/AnimatedBilly";
import { Card } from "@/components/ui/Card";
import { formatDateLabel } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import type { Series, SpendingInsights, SpendingStory } from "@/lib/domain/spending-insights";

// A friendly picture for each category, guessed from its name. First match wins.
const ICON_RULES: [RegExp, LucideIcon][] = [
  [/grocer|supermarket|food basics|no frills|costco/i, ShoppingCart],
  [/coffee|caf[eé]|tim hortons|\btims?\b|starbucks/i, Coffee],
  [/\beat|restaurant|dining|takeout|take-out|delivery|lunch|dinner|food/i, Utensils],
  [/pizza|snack/i, Pizza],
  [/barber|haircut/i, Scissors],
  [/\bbars?\b|drink|alcohol|wine|beer|lcbo|saq/i, Wine],
  [/gas|fuel/i, Fuel],
  [/transit|bus|train|metro|presto|subway/i, Train],
  [/\bcars?\b|uber|lyft|taxi|parking|transport/i, Car],
  [/cloth|apparel|shoe/i, Shirt],
  [/shop|amazon|store/i, ShoppingBag],
  [/fun|entertain|party|going out/i, PartyPopper],
  [/movie|cinema|film/i, Film],
  [/stream|netflix|\btv\b/i, Tv],
  [/music|concert|spotify/i, Music],
  [/personal|beauty|hair|nail|care|spa/i, Sparkles],
  [/pharm|drug|medic/i, Pill],
  [/health|doctor|dental|therapy/i, HeartPulse],
  [/gym|fitness|sport/i, Dumbbell],
  [/\bpets?\b|\bdogs?\b|\bcats?\b|\bvet/i, PawPrint],
  [/gift|present|donat|charity/i, Gift],
  [/kid|baby|child|daycare/i, Baby],
  [/travel|trip|vacation|flight|hotel/i, Plane],
  [/home|house|furniture|decor/i, House],
  [/repair|tool|hardware|maint/i, Wrench],
  [/phone|tech|electronic|gadget/i, Smartphone],
  [/school|course|tuition/i, GraduationCap],
  [/book/i, BookOpen],
  [/hydro|electric|utilit/i, Zap],
];

function iconFor(name: string): LucideIcon {
  if (name === "No category" || name === "Other") return Receipt;
  return ICON_RULES.find(([re]) => re.test(name))?.[1] ?? Receipt;
}

function seriesColor(s: Series | undefined): string {
  return s && s.slot !== null ? `var(--series-${s.slot + 1})` : "var(--series-other)";
}

function compact(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: currency === "CAD" ? "narrowSymbol" : "symbol", notation: "compact", maximumFractionDigits: 1 }).format(minor / 100);
}

function niceMax(v: number): number {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const SHOW_FIRST = 6;

/** "Where your money went": Billy's take, a split bar and a ranked list of categories. */
export function SpendingBreakdown({ insights, story, currency }: { insights: SpendingInsights; story: SpendingStory; currency: string }) {
  const [all, setAll] = useState(false);
  const money = (m: number) => formatMoney(m, currency);
  const series = new Map(insights.series.map((s) => [s.key, s]));
  // Never hide just one row behind a button.
  const folds = insights.parts.length > SHOW_FIRST + 1;
  const parts = all || !folds ? insights.parts : insights.parts.slice(0, SHOW_FIRST);
  const largest = insights.parts[0]?.amount_minor ?? 0;
  // The split bar draws one block per colored series (Other folds the rest), largest first.
  const blocks = insights.series
    .map((s) => ({ s, amount: insights.parts.filter((p) => p.seriesKey === s.key).reduce((a, p) => a + p.amount_minor, 0) }))
    .filter((b) => b.amount > 0)
    .sort((a, b) => (a.s.slot === null ? 1 : b.s.slot === null ? -1 : b.amount - a.amount));

  return (
    <Card className="overflow-hidden" data-testid="spending-breakdown">
      <div className="flex items-center gap-3 p-4 pb-3 sm:p-5 sm:pb-3">
        <div className="shrink-0 [--billy-ink:#1b2612]">
          <AnimatedBilly animation={story.animation} size={64} decorative loading="lazy" />
        </div>
        <div className="min-w-0">
          <p className="font-display text-lg leading-tight font-extrabold" data-testid="spending-headline">
            {story.headline}
          </p>
          <p className="mt-1 text-sm text-muted">{story.body}</p>
        </div>
      </div>

      {insights.parts.length > 0 && (
        <>
          <div className="px-4 sm:px-5">
            <div className="flex h-2.5 gap-0.5" role="img" aria-label={`Spending split: ${insights.parts.map((p) => `${p.name} ${Math.round(p.share * 100)}%`).join(", ")}`}>
              {blocks.map((b) => (
                <span key={b.s.key} className="h-full min-w-1 rounded-full" style={{ flexGrow: b.amount, flexBasis: 0, background: seriesColor(b.s) }} title={`${b.s.name}: ${money(b.amount)}`} />
              ))}
            </div>
          </div>
          <ul className="mt-2 divide-y divide-line">
            {parts.map((p, i) => {
              const Icon = iconFor(p.name);
              const color = seriesColor(series.get(p.seriesKey));
              return (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3 sm:px-5" data-testid="spending-part">
                  <span
                    className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: `color-mix(in srgb, ${color} 22%, transparent)`, color }}
                    aria-hidden
                  >
                    <Icon size={19} strokeWidth={2.2} />
                    {i === 0 && insights.parts.length > 1 && (
                      <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-lime text-[11px] font-extrabold text-ink">1</span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-semibold">{p.name}</span>
                      <span className="shrink-0 text-sm tabular">
                        <span className="font-bold">{money(p.amount_minor)}</span>
                        <span className="ml-1.5 text-muted">{Math.round(p.share * 100)}%</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg" aria-hidden>
                      <div className="h-full rounded-full bg-ivory/70" style={{ width: `${largest > 0 ? Math.max(2, (p.amount_minor / largest) * 100) : 0}%` }} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {folds && (
            <button type="button" onClick={() => setAll((v) => !v)} className="flex w-full items-center justify-center gap-1.5 border-t border-line py-3 text-sm font-semibold text-muted hover:bg-ivory/5 hover:text-ivory">
              {all ? "Show less" : `Show all ${insights.parts.length}`}
              <ChevronDown size={16} className={all ? "rotate-180" : ""} aria-hidden />
            </button>
          )}
        </>
      )}
    </Card>
  );
}

const W = 360;
const H = 180;
const PAD = { top: 8, right: 4, bottom: 24, left: 38 };
const GAP = 2;

/** Spending per month, stacked by category, ending at the month on screen. Tap a month to read it. */
export function SpendingTrend({ insights, currency }: { insights: SpendingInsights; currency: string }) {
  const { trend, series } = insights;
  const [sel, setSel] = useState(trend.length - 1);
  const money = (m: number) => formatMoney(m, currency);
  const yMax = niceMax(Math.max(...trend.map((t) => t.total_minor)) * 1.05);
  const plotW = W - PAD.left - PAD.right;
  const slot = plotW / trend.length;
  const colW = Math.min(40, slot * 0.6);
  const base = H - PAD.bottom;
  const y = (v: number) => (v / yMax) * (base - PAD.top);
  const ticks = [0, 0.5, 1].map((f) => yMax * f);
  const picked = trend[sel];
  // Stack bottom-up in series order, so each category sits at the same level every month.
  const stackOrder = series;

  return (
    <Card className="p-4 sm:p-5" data-testid="spending-trend">
      <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-muted">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: seriesColor(s) }} aria-hidden /> {s.name}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 block h-auto w-full select-none" role="img" aria-label={`Spending by month: ${trend.map((t) => `${formatDateLabel(t.month, { month: "long" })} ${money(t.total_minor)}`).join(", ")}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={base - y(t)} y2={base - y(t)} stroke="var(--color-line)" strokeWidth="1" />
            <text x={PAD.left - 8} y={base - y(t) + 4} textAnchor="end" fontSize="11" fill="var(--color-muted)">
              {compact(t, currency)}
            </text>
          </g>
        ))}
        {trend.map((t, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          const x0 = cx - colW / 2;
          const segs = stackOrder.map((s) => ({ s, v: t.bySeries[s.key] ?? 0 })).filter((g) => g.v > 0);
          let acc = 0;
          const active = i === sel;
          return (
            <g key={t.month} opacity={active ? 1 : 0.5}>
              {segs.map((g, j) => {
                const h = Math.max(1, y(g.v) - (j < segs.length - 1 ? GAP : 0));
                const top = base - y(acc) - h;
                acc += g.v;
                const isTop = j === segs.length - 1;
                const r = Math.min(4, h);
                const d = isTop
                  ? `M${x0},${top + h}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + colW - r}Q${x0 + colW},${top} ${x0 + colW},${top + r}V${top + h}Z`
                  : `M${x0},${top + h}V${top}H${x0 + colW}V${top + h}Z`;
                return <path key={g.s.key} d={d} fill={seriesColor(g.s)} />;
              })}
              <text x={cx} y={H - 6} textAnchor="middle" fontSize="11" fontWeight={active ? 700 : 400} fill={active ? "var(--color-ivory)" : "var(--color-muted)"}>
                {formatDateLabel(t.month, { month: "short" })}
              </text>
              {/* Hit target: the whole column slot, taller than the bar. */}
              <rect
                x={PAD.left + slot * i}
                y={PAD.top}
                width={slot}
                height={H - PAD.top}
                fill="transparent"
                className="cursor-pointer"
                onPointerEnter={(e) => e.pointerType === "mouse" && setSel(i)}
                onClick={() => setSel(i)}
              />
            </g>
          );
        })}
      </svg>
      <div className="mt-3 rounded-xl bg-bg/60 p-3 text-sm" aria-live="polite" data-testid="trend-readout">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold">{formatDateLabel(picked.month, { month: "long", year: "numeric" })}</span>
          <span className="font-bold tabular">{money(picked.total_minor)}</span>
        </div>
        {picked.total_minor === 0 ? (
          <p className="mt-1 text-muted">Nothing logged.</p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {series
              .filter((s) => (picked.bySeries[s.key] ?? 0) > 0)
              .sort((a, b) => picked.bySeries[b.key] - picked.bySeries[a.key])
              .map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-3 text-muted">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: seriesColor(s) }} aria-hidden />
                    <span className="truncate">{s.name}</span>
                  </span>
                  <span className="tabular text-ivory">{money(picked.bySeries[s.key])}</span>
                </li>
              ))}
          </ul>
        )}
        {sel !== trend.length - 1 && (
          <Link href={`/budget?month=${picked.month.slice(0, 7)}`} className="mt-2 inline-block font-semibold text-lime hover:underline">
            Open {formatDateLabel(picked.month, { month: "long" })}
          </Link>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">Tap a month to see its split. Logged spending only; bills are counted separately.</p>
    </Card>
  );
}
