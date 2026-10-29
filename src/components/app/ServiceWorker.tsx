"use client";

import { useEffect } from "react";

/** Registers the service worker (push + offline cache). Safe no-op where unsupported. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}

export async function clearOfflineCache() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    reg?.active?.postMessage({ type: "clear-cache" });
    if ("caches" in window) for (const k of await caches.keys()) await caches.delete(k);
  } catch {
    // ignore
  }
}
