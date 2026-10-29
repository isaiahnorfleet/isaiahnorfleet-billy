import Link from "next/link";
import { UserRound } from "lucide-react";
import { BillyMascot } from "@/components/billy/BillyMascot";
import { BottomNav, SideNav } from "@/components/app/NavLinks";
import { OfflineBanner } from "@/components/app/OfflineBanner";
import { ServiceWorkerRegistrar } from "@/components/app/ServiceWorker";
import { SignOutButton } from "@/components/app/SignOutButton";
import { ToastProvider } from "@/components/ui/Toast";
import { Wordmark } from "@/components/ui/Wordmark";
import { requireUser } from "@/lib/auth/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <ToastProvider>
      <OfflineBanner />
      <ServiceWorkerRegistrar />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-lime focus:px-4 focus:py-2 focus:text-ink">
        Skip to content
      </a>
      <div className="mx-auto flex min-h-dvh max-w-[1400px]">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line px-4 py-6 lg:flex">
          <Link href="/" className="mb-8 px-3">
            <Wordmark className="text-4xl" />
          </Link>
          <SideNav />
          <div className="mt-auto">
            <div className="mb-4 flex items-end gap-2 px-2 opacity-90">
              <BillyMascot mood="neutral" size={64} decorative />
              <p className="pb-3 font-display text-sm font-bold text-muted italic">Same bills. Brighter days.</p>
            </div>
            <SignOutButton />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between px-4 pt-[calc(0.75rem+var(--safe-top))] pb-1 lg:hidden">
            <Link href="/" aria-label="Billy home">
              <Wordmark className="text-3xl" />
            </Link>
            <Link href="/settings" className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-ivory" aria-label="Settings and profile">
              <UserRound size={20} aria-hidden />
            </Link>
          </header>
          <main id="main" className="w-full flex-1 px-4 pt-3 pb-[calc(6rem+var(--safe-bottom))] sm:px-6 lg:px-10 lg:pt-8 lg:pb-12">
            {children}
          </main>
        </div>
      </div>
      <BottomNav />
    </ToastProvider>
  );
}
