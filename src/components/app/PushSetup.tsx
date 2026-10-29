"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellOff, BellRing, Share, SquarePlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { removePushSubscriptionAction, savePushSubscriptionAction } from "@/app/actions/settings";

type Support =
  | { kind: "checking" }
  | { kind: "ios-needs-install" }
  | { kind: "unsupported"; reason: string }
  | { kind: "ready"; permission: NotificationPermission; subscribed: boolean };

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function deviceLabel(ua: string): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return [os, browser].filter(Boolean).join(" ");
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function PushSetup({ vapidPublicKey, serverReady, onDone }: { vapidPublicKey: string | null; serverReady: boolean; onDone?: () => void }) {
  const [support, setSupport] = useState<Support>({ kind: "checking" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const refresh = useCallback(async () => {
    const hasApis = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!hasApis) {
      if (isIos() && !isStandalone()) return setSupport({ kind: "ios-needs-install" });
      return setSupport({ kind: "unsupported", reason: "This browser doesn't support web push notifications." });
    }
    if (isIos() && !isStandalone()) return setSupport({ kind: "ios-needs-install" });
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setSupport({ kind: "ready", permission: Notification.permission, subscribed: Boolean(sub) && Notification.permission === "granted" });
    // Keep the server copy in sync (subscriptions can rotate).
    if (sub && Notification.permission === "granted") {
      const json = sub.toJSON();
      if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
        void savePushSubscriptionAction({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth }, deviceLabel: deviceLabel(navigator.userAgent), userAgent: navigator.userAgent });
      }
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);

  const enable = () =>
    start(async () => {
      setError(null);
      try {
        if (!vapidPublicKey) throw new Error("Push isn't configured on the server yet.");
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setSupport({ kind: "ready", permission, subscribed: false });
          return;
        }
        const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
        await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
        const json = sub.toJSON();
        const res = await savePushSubscriptionAction({
          endpoint: json.endpoint!,
          keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! },
          deviceLabel: deviceLabel(navigator.userAgent),
          userAgent: navigator.userAgent,
        });
        if (!res.ok) throw new Error(res.error);
        await refresh();
        router.refresh();
        onDone?.();
      } catch (e) {
        setError((e as Error).message || "Couldn't turn on notifications.");
      }
    });

  const disable = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscriptionAction({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      await refresh();
      router.refresh();
    });

  if (support.kind === "checking") return <p className="text-muted">Checking this device…</p>;

  if (support.kind === "ios-needs-install") {
    return (
      <div className="space-y-3 rounded-xl border border-line bg-bg p-4" data-testid="ios-install-steps">
        <p className="font-semibold">On iPhone, add Billy to your Home Screen first</p>
        <p className="text-sm text-muted">Apple only allows web app notifications after the app is added to the Home Screen (iOS 16.4 or later).</p>
        <ol className="space-y-2 text-sm">
          <li className="flex items-center gap-2">
            <span className="font-bold text-lime">1.</span> In Safari, tap <Share size={16} aria-label="Share" /> Share
          </li>
          <li className="flex items-center gap-2">
            <span className="font-bold text-lime">2.</span> Choose <SquarePlus size={16} aria-hidden /> &ldquo;Add to Home Screen&rdquo;
          </li>
          <li className="flex items-center gap-2">
            <span className="font-bold text-lime">3.</span> Open Billy from your Home Screen and come back here
          </li>
        </ol>
      </div>
    );
  }

  if (support.kind === "unsupported") return <p className="rounded-xl border border-line p-4 text-muted">{support.reason} Email reminders still work.</p>;

  if (!serverReady) {
    return <p className="rounded-xl border border-amber/40 bg-amber/10 p-4 text-sm text-amber">Push isn&apos;t configured on the server yet, so this device can&apos;t subscribe. Email reminders can still be used.</p>;
  }

  if (support.permission === "denied") {
    return (
      <div className="space-y-2 rounded-xl border border-peach/40 bg-peach/5 p-4" data-testid="push-denied">
        <p className="flex items-center gap-2 font-semibold text-peach">
          <BellOff size={18} aria-hidden /> Notifications are blocked for Billy on this device
        </p>
        <p className="text-sm text-muted">
          Billy keeps working, and you can still use email reminders. To allow notifications: on iPhone, go to Settings › Notifications › Billy. In a desktop browser, use the site settings next to the address bar.
        </p>
      </div>
    );
  }

  if (support.subscribed) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ok/30 bg-ok/5 p-4">
        <p className="flex items-center gap-2 font-semibold text-ok">
          <BellRing size={18} aria-hidden /> Notifications are on for this device
        </p>
        <Button variant="ghost" size="sm" onClick={disable} disabled={pending}>
          Turn off here
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-muted">Get a heads-up a few days before, on the due date, and if something slips. Billy sends these from the server, so they arrive even when the app is closed.</p>
      <Button onClick={enable} disabled={pending} size="lg">
        <BellRing size={18} aria-hidden /> {pending ? "Waiting for permission…" : "Turn on notifications"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-peach">
          {error}
        </p>
      )}
    </div>
  );
}
