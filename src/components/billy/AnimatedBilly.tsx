import type { Mood } from "@/lib/domain/billy-messages";
import { billyAnimation, type BillyAnimation } from "@/lib/domain/billy-animation";
import { BillyMascot } from "./BillyMascot";

/**
 * Billy as a looping animated clip, sized to match BillyMascot at the same `size`.
 * With reduced motion on, the still SVG Billy shows instead.
 */
export function AnimatedBilly({
  mood = "neutral",
  animation,
  size = 120,
  className = "",
  decorative = false,
  loading,
}: {
  mood?: Mood;
  animation?: BillyAnimation;
  size?: number;
  className?: string;
  decorative?: boolean;
  loading?: "eager" | "lazy";
}) {
  const clip = animation ?? billyAnimation(mood);
  // The clips are square; match the SVG's height so layouts don't shift between the two.
  const side = Math.round((size * 162) / 120);
  return (
    <span className={`inline-block ${className}`} data-animation={clip}>
      {/* eslint-disable-next-line @next/next/no-img-element -- animated WebP; next/image would re-encode it */}
      <img
        src={`/billy/${clip}.webp`}
        width={side}
        height={side}
        alt={decorative ? "" : `Billy, ${clip.replace(/-/g, " ")}`}
        aria-hidden={decorative || undefined}
        decoding="async"
        loading={loading}
        className="block max-w-none motion-reduce:hidden"
        style={{ width: side, height: side, marginInline: -(side - size) / 2 }}
      />
      <BillyMascot mood={mood} size={size} decorative={decorative} className="hidden motion-reduce:block" />
    </span>
  );
}
