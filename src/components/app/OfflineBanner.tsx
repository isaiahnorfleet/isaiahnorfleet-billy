"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/** Honest offline indicator: cached screens may show, but nothing can be saved until reconnected. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber px-4 py-2 text-sm font-semibold text-ink">
      <WifiOff size={16} aria-hidden /> You&apos;re offline. You may be seeing saved info, and changes won&apos;t be saved until you reconnect.
    </div>
  );
}
