"use client";

import { useId, useRef, useState } from "react";
import { formatDateLabel } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import type { ProjectionPoint } from "@/lib/domain/projection";

const W = 640;
const H = 220;
const PAD = { top: 16, right: 12, bottom: 28, left: 52 };

function compact(minor: number, currency: string): string {
  const v = minor / 100;
  const fmt = new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: currency === "CAD" ? "narrowSymbol" : "symbol", notation: "compact", maximumFractionDigits: 1 });
  return fmt.format(v);
}

/** A "nice" axis maximum: 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(v: number): number {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/**
 * Projected balance for one goal. Two series: the projected balance (lime) and what you put in
 * yourself (dashed), so the gap between them is growth. Target is a reference line.
 */
export function GoalChart({ name, points, target, reachIndex, currency }: { name: string; points: ProjectionPoint[]; target: number | null; reachIndex: number | null; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/:/g, "");
  const last = points[points.length - 1];
  const yMax = niceMax(Math.max(last.value_minor, target ?? 0) * 1.05);
  const n = points.length - 1;
  const x = (i: number) => PAD.left + (i / Math.max(1, n)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / yMax) * (H - PAD.top - PAD.bottom);
  const path = (key: "value_minor" | "contributed_minor") => points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
  const area = `${path("value_minor")}L${x(n).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const showContrib = points.some((p) => p.value_minor !== p.contributed_minor);
  const ticks = [0, 0.5, 1].map((f) => yMax * f);
  // Year ticks along the bottom: about four, on January or every N years.
  const years = Math.max(1, Math.ceil(n / 12 / 4));
  const xTicks = points.filter((p) => p.index > 0 && p.index % (12 * years) === 0);
  const h = hover !== null ? points[hover] : null;

  const onMove = (clientX: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * n);
    setHover(Math.max(0, Math.min(n, i)));
  };

  return (
    <figure className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-lime" /> Projected balance
        </span>
        {showContrib && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed border-muted" /> What you put in (the gap is interest)
          </span>
        )}
        {target !== null && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dotted border-ivory/60" /> Target
          </span>
        )}
      </div>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full touch-pan-y select-none"
          role="img"
          aria-label={`${name}: projected to reach ${formatMoney(last.value_minor, currency)} by ${formatDateLabel(last.month, { month: "short", year: "numeric" })}`}
          onPointerMove={(e) => onMove(e.clientX)}
          onPointerDown={(e) => onMove(e.clientX)}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`fill-${uid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-lime)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--color-lime)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth="1" />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--color-muted)">
                {compact(t, currency)}
              </text>
            </g>
          ))}
          {xTicks.map((p) => (
            <text key={p.index} x={x(p.index)} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--color-muted)">
              {formatDateLabel(p.month, { month: "short", year: "numeric" })}
            </text>
          ))}
          <text x={x(0)} y={H - 8} textAnchor="start" fontSize="12" fill="var(--color-muted)">
            Now
          </text>
          <path d={area} fill={`url(#fill-${uid})`} />
          {showContrib && <path d={path("contributed_minor")} fill="none" stroke="var(--color-muted)" strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" />}
          <path d={path("value_minor")} fill="none" stroke="var(--color-lime)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {target !== null && (
            <line x1={PAD.left} x2={W - PAD.right} y1={y(target)} y2={y(target)} stroke="var(--color-ivory)" strokeOpacity="0.6" strokeWidth="1.5" strokeDasharray="2 4" />
          )}
          {reachIndex !== null && reachIndex <= n && (
            <circle cx={x(reachIndex)} cy={y(points[reachIndex].value_minor)} r="6" fill="var(--color-lime)" stroke="var(--color-panel)" strokeWidth="2" />
          )}
          {h && (
            <g>
              <line x1={x(h.index)} x2={x(h.index)} y1={PAD.top} y2={y(0)} stroke="var(--color-ivory)" strokeOpacity="0.35" strokeWidth="1" />
              <circle cx={x(h.index)} cy={y(h.value_minor)} r="5" fill="var(--color-lime)" stroke="var(--color-panel)" strokeWidth="2" />
            </g>
          )}
        </svg>
        {h && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-xl border border-line bg-bg/95 px-3 py-2 text-xs shadow-lg"
            style={{ left: `${(x(h.index) / W) * 100}%`, transform: `translateX(${h.index > n / 2 ? "-105%" : "5%"})` }}
          >
            <p className="font-semibold text-ivory">{h.index === 0 ? "Now" : formatDateLabel(h.month, { month: "short", year: "numeric" })}</p>
            <p className="tabular text-ivory">{formatMoney(h.value_minor, currency)}</p>
            {showContrib && <p className="tabular text-muted">{formatMoney(h.contributed_minor, currency)} put in</p>}
            {showContrib && h.value_minor > h.contributed_minor && <p className="tabular text-lime">+{formatMoney(h.value_minor - h.contributed_minor, currency)} interest</p>}
          </div>
        )}
      </div>
    </figure>
  );
}
