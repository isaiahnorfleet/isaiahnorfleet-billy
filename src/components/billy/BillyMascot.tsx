import type { Mood } from "@/lib/domain/billy-messages";

/**
 * Billy: an original receipt character with a folded corner, jagged bottom, expressive brows,
 * thin arms and legs, and sneakers. Pure SVG so it scales crisply and themes from tokens.
 * Animation classes are defined in globals.css and disabled under prefers-reduced-motion.
 */

const INK = "var(--billy-ink)";
const BODY = "var(--color-lime)";
const SHADE = "var(--billy-shade)";
const WHITE = "var(--color-ivory)";
const LIMB = "var(--billy-limb)";

const MOOD_LABEL: Record<Mood, string> = {
  neutral: "Billy, smiling",
  heads_up: "Billy, raising a finger for a heads-up",
  due_today: "Billy, pointing: today's the day",
  overdue: "Billy, looking concerned",
  celebrating: "Billy, celebrating with both arms up",
  all_clear: "Billy, relaxed and giving a thumbs-up",
};

function Eyes({ mood }: { mood: Mood }) {
  if (mood === "celebrating") {
    // Happy closed eyes
    return (
      <g fill="none" stroke={INK} strokeWidth={3.2} strokeLinecap="round">
        <path d="M42 54 q6 -8 12 0" />
        <path d="M64 54 q6 -8 12 0" />
      </g>
    );
  }
  const look = { neutral: [1, 1], heads_up: [2, -1], due_today: [3, 0], overdue: [0, 2], all_clear: [1, 1], celebrating: [0, 0] }[mood];
  const lids = mood === "all_clear";
  return (
    <g>
      <ellipse cx={48} cy={53} rx={8.5} ry={lids ? 7 : 10.5} fill={WHITE} stroke={INK} strokeWidth={2.4} />
      <ellipse cx={70} cy={53} rx={8.5} ry={lids ? 7 : 10.5} fill={WHITE} stroke={INK} strokeWidth={2.4} />
      <circle cx={49 + look[0]} cy={55 + look[1]} r={4.2} fill={INK} />
      <circle cx={71 + look[0]} cy={55 + look[1]} r={4.2} fill={INK} />
      <circle cx={50.5 + look[0]} cy={53.5 + look[1]} r={1.3} fill={WHITE} />
      <circle cx={72.5 + look[0]} cy={53.5 + look[1]} r={1.3} fill={WHITE} />
      {lids && (
        <g fill={BODY} stroke={INK} strokeWidth={2.4}>
          <path d="M39.5 51 a8.5 7 0 0 1 17 0 z" />
          <path d="M61.5 51 a8.5 7 0 0 1 17 0 z" />
        </g>
      )}
    </g>
  );
}

function Brows({ mood }: { mood: Mood }) {
  const d: Record<Mood, [string, string]> = {
    neutral: ["M40 38 q8 -5 15 -1", "M63 37 q7 -4 15 1"],
    heads_up: ["M40 34 q8 -6 15 -2", "M63 32 q7 -5 15 0"],
    due_today: ["M41 39 l14 -3", "M63 36 l14 3"],
    overdue: ["M41 37 q7 -1 13 -6", "M64 31 q6 5 13 6"],
    celebrating: ["M40 35 q8 -6 15 -2", "M63 33 q7 -5 15 2"],
    all_clear: ["M41 40 q7 -3 14 -1", "M63 39 q7 -2 14 1"],
  };
  return (
    <g fill="none" stroke={INK} strokeWidth={3.4} strokeLinecap="round">
      <path d={d[mood][0]} />
      <path d={d[mood][1]} />
    </g>
  );
}

function Mouth({ mood }: { mood: Mood }) {
  switch (mood) {
    case "celebrating":
      return <path d="M46 70 q13 16 26 0 z" fill={INK} stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />;
    case "heads_up":
      return <ellipse cx={59} cy={73} rx={4} ry={4.5} fill={INK} />;
    case "overdue":
      return <path d="M49 75 q5 -4 10 0 t10 0" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />;
    case "due_today":
      return <path d="M49 71 q10 8 21 -1" fill="none" stroke={INK} strokeWidth={3.2} strokeLinecap="round" />;
    case "all_clear":
      return <path d="M50 71 q9 7 18 0" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />;
    default:
      return <path d="M48 70 q11 10 22 0" fill="none" stroke={INK} strokeWidth={3.2} strokeLinecap="round" />;
  }
}

function Arms({ mood }: { mood: Mood }) {
  const arm = { fill: "none", stroke: LIMB, strokeWidth: 3.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const hand = { fill: WHITE, stroke: INK, strokeWidth: 2 };
  switch (mood) {
    case "celebrating":
      return (
        <g className="billy-wave">
          <path d="M28 70 q-12 -10 -14 -30" {...arm} />
          <circle cx={14} cy={37} r={5.6} {...hand} />
          <path d="M92 70 q12 -10 14 -30" {...arm} />
          <circle cx={106} cy={37} r={5.6} {...hand} />
        </g>
      );
    case "heads_up":
      return (
        <g>
          <path d="M28 76 q-10 8 -8 20" {...arm} />
          <circle cx={20} cy={98} r={5.2} {...hand} />
          <path d="M92 72 q12 -4 12 -22" {...arm} />
          <circle cx={104} cy={48} r={5.6} {...hand} />
          <path d="M104 43 v-9" stroke={INK} strokeWidth={4} strokeLinecap="round" />
          <path d="M104 43 v-9" stroke={WHITE} strokeWidth={1.8} strokeLinecap="round" />
        </g>
      );
    case "due_today":
      return (
        <g>
          <path d="M28 76 q-10 6 -10 18" {...arm} />
          <circle cx={18} cy={96} r={5.2} {...hand} />
          <path d="M92 74 q10 -2 18 -8" {...arm} />
          <circle cx={111} cy={65} r={5.6} {...hand} />
          <path d="M115 63 l7 -3" stroke={INK} strokeWidth={4} strokeLinecap="round" />
          <path d="M115 63 l7 -3" stroke={WHITE} strokeWidth={1.8} strokeLinecap="round" />
        </g>
      );
    case "overdue":
      return (
        <g>
          <path d="M28 78 q-8 -2 -2 -12" {...arm} />
          <circle cx={30} cy={64} r={5.2} {...hand} />
          <path d="M92 78 q8 -2 2 -12" {...arm} />
          <circle cx={90} cy={64} r={5.2} {...hand} />
        </g>
      );
    case "all_clear":
      return (
        <g>
          <path d="M28 76 q-10 8 -8 20" {...arm} />
          <circle cx={20} cy={98} r={5.2} {...hand} />
          <path d="M92 76 q12 -2 12 -14" {...arm} />
          <rect x={99} y={56} width={10} height={9} rx={3} {...hand} />
          <path d="M104 56 v-6" stroke={INK} strokeWidth={4} strokeLinecap="round" />
          <path d="M104 56 v-6" stroke={WHITE} strokeWidth={1.8} strokeLinecap="round" />
        </g>
      );
    default:
      return (
        <g>
          <path d="M28 76 q-10 8 -8 20" {...arm} />
          <circle cx={20} cy={98} r={5.2} {...hand} />
          <path d="M92 76 q10 8 8 20" {...arm} />
          <circle cx={100} cy={98} r={5.2} {...hand} />
        </g>
      );
  }
}

function Extras({ mood }: { mood: Mood }) {
  if (mood === "celebrating") {
    return (
      <g stroke="var(--color-lime)" strokeWidth={3} strokeLinecap="round" className="billy-sparks">
        <path d="M8 22 l-4 -6" />
        <path d="M16 16 l0 -8" />
        <path d="M112 22 l4 -6" />
        <path d="M104 16 l0 -8" />
      </g>
    );
  }
  if (mood === "heads_up" || mood === "due_today") {
    return (
      <g stroke="var(--color-lime)" strokeWidth={3} strokeLinecap="round">
        <path d="M100 24 l4 -8" />
        <path d="M108 30 l8 -4" />
      </g>
    );
  }
  if (mood === "overdue") {
    return (
      <g>
        <path d="M86 30 q4 6 0 9 q-4 -3 0 -9 z" fill="var(--color-peach)" />
        <g stroke="var(--color-peach)" strokeWidth={3} strokeLinecap="round">
          <path d="M98 22 l4 -7" />
          <path d="M105 28 l7 -3" />
        </g>
      </g>
    );
  }
  return null;
}

export function BillyMascot({ mood = "neutral", size = 120, className = "", decorative = false }: { mood?: Mood; size?: number; className?: string; decorative?: boolean }) {
  // Receipt body: folded top-right corner and a jagged (torn) bottom edge.
  const teeth = Array.from({ length: 8 }, (_, i) => {
    const x = 92 - i * 8;
    return `L${x - 4} 122 L${x - 8} 114`;
  }).join(" ");
  const body = `M30 22 Q30 16 36 16 L80 16 L92 28 L92 114 ${teeth} Z`;
  return (
    <svg
      viewBox="0 0 120 162"
      width={size}
      height={(size * 162) / 120}
      className={`billy billy-${mood} ${className}`}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : MOOD_LABEL[mood]}
      data-mood={mood}
    >
      <ellipse cx={60} cy={156} rx={34} ry={4} fill="black" opacity={0.25} />
      {/* legs */}
      <g stroke={LIMB} strokeWidth={3.6} strokeLinecap="round">
        <path d="M50 120 L48 146" />
        <path d="M70 120 L72 146" />
      </g>
      {/* sneakers */}
      <g stroke={INK} strokeWidth={2.2} strokeLinejoin="round">
        <path d="M36 150 q0 -8 10 -8 h6 q6 0 8 6 v4 h-24 z" fill={WHITE} />
        <path d="M66 148 q2 -6 8 -6 h6 q10 0 10 8 v2 h-24 z" fill={WHITE} />
        <path d="M36 152 h24" />
        <path d="M66 152 h24" />
      </g>
      <g className="billy-body">
        {mood !== "overdue" && <Arms mood={mood} />}
        <path d={body} fill={BODY} stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
        <path d="M80 16 L80 28 L92 28 Z" fill={SHADE} stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
        <g stroke={SHADE} strokeWidth={3} strokeLinecap="round">
          <path d="M44 92 h32" />
          <path d="M44 101 h22" />
        </g>
        <Brows mood={mood} />
        <Eyes mood={mood} />
        <Mouth mood={mood} />
        {mood === "overdue" && <Arms mood={mood} />}
      </g>
      <Extras mood={mood} />
    </svg>
  );
}
