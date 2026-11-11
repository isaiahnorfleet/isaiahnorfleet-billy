"use client";

import { useState, useSyncExternalStore } from "react";
import { GoalChart } from "@/components/app/GoalChart";
import { Card } from "@/components/ui/Card";
import { formatDateLabel } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { HORIZONS, isHorizon, milestoneYears, type Horizon, type Projection } from "@/lib/domain/projection";

function duration(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [y > 0 ? `${y} ${y === 1 ? "year" : "years"}` : "", m > 0 ? `${m} ${m === 1 ? "month" : "months"}` : ""].filter(Boolean);
  return parts.join(" ") || "this month";
}

const storageKey = (id: string) => `billy:goal-years:${id}`;

function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readSaved(id: string): Horizon | null {
  try {
    const v = Number(window.localStorage.getItem(storageKey(id)));
    return isHorizon(v) ? v : null;
  } catch {
    return null;
  }
}

/** One goal's projection with a picker for how far ahead to look (5 to 50 years). */
export function GoalProjectionCard({
  id,
  name,
  target,
  balance,
  annualReturnBp,
  p,
  currency,
}: {
  id: string;
  name: string;
  target: number | null;
  balance: number;
  annualReturnBp: number;
  p: Projection;
  currency: string;
}) {
  // Remember the choice on this device. The server renders the default; the saved choice applies after hydration.
  const saved = useSyncExternalStore(subscribeStorage, () => readSaved(id), () => null);
  const [picked, setPicked] = useState<Horizon | null>(null);
  const years: Horizon = picked ?? saved ?? p.defaultYears;
  const choose = (y: Horizon) => {
    setPicked(y);
    try {
      window.localStorage.setItem(storageKey(id), String(y));
    } catch {
      /* storage unavailable: the choice lasts until reload */
    }
  };

  const money = (m: number) => formatMoney(m, currency);
  const pace = `${money(p.monthly_minor)} a month`;
  const end = p.points[years * 12];
  let headline: string;
  if (p.monthly_minor === 0 && balance === 0) headline = "Add income so Billy can work out what this goal sets aside.";
  else if (target !== null && p.reach?.index === 0) headline = `You've already reached your ${money(target)} target. In ${years} years you'd have about ${money(end.value_minor)}.`;
  else if (target !== null && p.reach)
    headline = `At ${pace}, you'll reach ${money(target)} by ${formatDateLabel(p.reach.month, { month: "long", year: "numeric" })}, in ${duration(p.reach.index)}.`;
  else if (target !== null) headline = `At ${pace}, ${money(target)} is more than 50 years away. Raise the amount to get there sooner.`;
  else headline = `At ${pace}, you'll have about ${money(end.value_minor)} in ${years} years.`;
  // Interest earned by the point the headline talks about.
  const at = target !== null && p.reach && p.reach.index > 0 ? p.reach : end;
  const interest = at.value_minor - at.contributed_minor;
  if (annualReturnBp > 0 && interest > 0 && !(target !== null && !p.reach)) headline += ` ${money(interest)} of that is interest.`;
  const showChart = p.monthly_minor > 0 || balance > 0;

  return (
    <Card className="space-y-3 p-4 sm:p-5" data-testid="goal-projection">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-bold">{name}</h3>
        <span className="text-xs text-muted">
          {balance > 0 ? `${money(balance)} saved` : "Starting from $0"}
          {annualReturnBp > 0 ? ` · ${annualReturnBp / 100}%/yr` : ""}
        </span>
      </div>
      <p className="text-sm">{headline}</p>
      {target !== null && (
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-bg" role="progressbar" aria-label={`${name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round((balance / target) * 100))}>
            <div className="h-full rounded-full bg-lime" style={{ width: `${Math.min(100, (balance / target) * 100)}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted">
            {money(balance)} of {money(target)}
          </p>
        </div>
      )}
      {showChart && (
        <>
          <div role="group" aria-label="Projection length" className="flex gap-1 overflow-x-auto rounded-[var(--radius-control)] bg-bg p-1">
            {HORIZONS.map((h) => (
              <button
                key={h}
                type="button"
                aria-pressed={years === h}
                onClick={() => choose(h)}
                className={`min-h-9 flex-1 rounded-[calc(var(--radius-control)-4px)] px-2 text-sm font-semibold whitespace-nowrap transition-colors ${years === h ? "bg-lime text-ink" : "text-muted hover:text-ivory"}`}
              >
                {h}y
              </button>
            ))}
          </div>
          <GoalChart name={name} points={p.points.slice(0, years * 12 + 1)} target={target} reachIndex={p.reach && p.reach.index <= years * 12 ? p.reach.index : null} currency={currency} />
          {target !== null && p.reach && p.reach.index > years * 12 && (
            <p className="text-xs text-muted">Your target is past the end of this chart. Pick a longer view to see it.</p>
          )}
        </>
      )}
      <dl className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-sm" data-testid="goal-milestones">
        {milestoneYears(years).map((y) => {
          const m = p.points[y * 12];
          return (
            <div key={y}>
              <dt className="text-muted">
                In {y} {y === 1 ? "year" : "years"}
              </dt>
              <dd className="font-bold tabular">{money(m.value_minor)}</dd>
              {annualReturnBp > 0 && m.value_minor > m.contributed_minor && <dd className="text-xs text-muted tabular">+{money(m.value_minor - m.contributed_minor)} interest</dd>}
            </div>
          );
        })}
      </dl>
    </Card>
  );
}
