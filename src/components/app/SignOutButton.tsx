"use client";

import { LogOut } from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import { clearOfflineCache } from "./ServiceWorker";

export function SignOutButton({ className = "" }: { className?: string }) {
  return (
    <form
      action={async () => {
        await clearOfflineCache();
        await signOutAction();
      }}
    >
      <button type="submit" className={`flex items-center gap-2 rounded-xl px-3 py-2.5 font-semibold text-muted hover:bg-ivory/5 hover:text-ivory ${className}`}>
        <LogOut size={18} aria-hidden /> Sign out
      </button>
    </form>
  );
}
