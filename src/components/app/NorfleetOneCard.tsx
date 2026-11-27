"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createConnectKeyAction, revokeConnectKeyAction } from "@/app/actions/connect";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

export interface ConnectKeyRow { key_id: string; created_at: string; expires_at: string; last_used_at: string | null; revoked_at: string | null; active: boolean }
export interface ConnectBills { business: number; mixed: number; personal: number; unclassified: number }

const day = (iso: string | null, tz: string) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: tz, month: "short", day: "numeric", year: "numeric" }) : "never");

/** Settings → Norfleet One: what is shared, the keys, and making or revoking one. */
export function NorfleetOneCard({ keys, bills, timeZone }: { keys: ConnectKeyRow[]; bills: ConnectBills; timeZone: string }) {
  const [pending, start] = useTransition();
  const [shown, setShown] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const active = keys.filter((k) => k.active);

  return (
    <div className="space-y-4">
      <ul className="grid gap-2 text-sm sm:grid-cols-2">
        <li className="rounded-xl border border-line p-3"><span className="font-semibold">{bills.business + bills.mixed}</span> shared (business {bills.business}, partly business {bills.mixed})</li>
        <li className="rounded-xl border border-line p-3"><span className="font-semibold">{bills.unclassified}</span> not sorted yet{bills.unclassified > 0 ? ": Norfleet One only sees how many" : ""}</li>
      </ul>
      <p className="text-sm text-muted">Norfleet One reads, never writes: each shared bill&apos;s name, amount, due dates, category, autopay and whether it&apos;s paid. Personal bills, notes, payment links, account nicknames and your budget stay in Billy.</p>

      {shown && (
        <div role="status" className="space-y-2 rounded-xl border border-lime/40 bg-lime/5 p-3 text-sm">
          <p className="font-semibold">Your new key. Copy it now: it won&apos;t be shown again.</p>
          <code className="block break-all rounded-lg bg-black/20 p-2 text-xs">{shown}</code>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => { navigator.clipboard?.writeText(shown).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? "Copied" : "Copy key"}</Button>
            <Button variant="secondary" onClick={() => setShown(null)}>Done</Button>
          </div>
          <p className="text-muted">Paste it in Norfleet One: Settings → Connected Ecosystem → Billy.</p>
        </div>
      )}

      {keys.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line text-sm">
          {keys.map((k) => {
            const live = k.active;
            return (
              <li key={k.key_id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div>
                  <p className="font-semibold">Key ••••{k.key_id.slice(-4)}</p>
                  <p className="text-xs text-muted">
                    {k.revoked_at ? `Revoked ${day(k.revoked_at, timeZone)}` : live ? `Expires ${day(k.expires_at, timeZone)} · last used ${day(k.last_used_at, timeZone)}` : `Expired ${day(k.expires_at, timeZone)}`}
                  </p>
                </div>
                {live && (
                  <Button variant="secondary" disabled={pending} onClick={() => start(async () => {
                    const res = await revokeConnectKeyAction(k.key_id);
                    if (!res.ok) toast({ title: res.error, tone: "error" });
                    else toast({ title: "Key revoked. Norfleet One can't read Billy with it any more." });
                    router.refresh();
                  })}>Revoke</Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Button disabled={pending || active.length >= 2} onClick={() => start(async () => {
        const res = await createConnectKeyAction();
        if (!res.ok) toast({ title: res.error, tone: "error" });
        else { setShown(res.key); setCopied(false); }
        router.refresh();
      })}>Make a key for Norfleet One</Button>
      {active.length >= 2 && <p className="text-xs text-muted">Two keys are active. Revoke the old one to make another.</p>}
    </div>
  );
}
