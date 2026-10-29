"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Clock3, FileText, Home, Settings } from "lucide-react";

export const NAV = [
  { href: "/", label: "Overview", short: "Overview", icon: Home },
  { href: "/bills", label: "My bills", short: "Bills", icon: FileText },
  { href: "/calendar", label: "Calendar", short: "Calendar", icon: CalendarDays },
  { href: "/history", label: "Payment history", short: "History", icon: Clock3 },
  { href: "/settings", label: "Settings", short: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 font-semibold transition-colors ${active ? "bg-lime/12 text-lime" : "text-ivory/85 hover:bg-ivory/5"}`}
          >
            <Icon size={20} strokeWidth={2.2} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[var(--safe-bottom)] backdrop-blur lg:hidden">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {NAV.map(({ href, short, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${active ? "text-lime" : "text-muted"}`}
              >
                <Icon size={22} strokeWidth={2.2} aria-hidden />
                {short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
