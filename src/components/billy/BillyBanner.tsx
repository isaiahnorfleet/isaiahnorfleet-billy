import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { BillyMessage } from "@/lib/domain/billy-messages";
import { BillyMascot } from "./BillyMascot";

export function BillyBanner({ message, cta }: { message: BillyMessage; cta?: { href: string; label: string } }) {
  return (
    <section aria-label="Billy says" className="relative overflow-hidden rounded-[1.5rem] bg-lime p-5 text-ink sm:p-7">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[1.75rem] leading-[1.05] font-extrabold sm:text-5xl">{message.headline}</h2>
          <p className="mt-2 text-[15px] font-medium sm:text-lg" data-testid="billy-message">
            {message.body}
          </p>
          {cta && (
            <Link href={cta.href} className="mt-4 inline-flex h-11 items-center gap-2 rounded-[var(--radius-control)] bg-ink px-4 font-semibold text-ivory hover:bg-black">
              {cta.label} <ArrowUpRight size={18} aria-hidden />
            </Link>
          )}
        </div>
        <div className="-mr-2 shrink-0 [--billy-ink:#1b2612]">
          <BillyMascot mood={message.mood} size={110} className="sm:hidden" />
          <BillyMascot mood={message.mood} size={170} className="hidden sm:block" />
        </div>
      </div>
    </section>
  );
}
