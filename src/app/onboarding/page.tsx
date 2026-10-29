import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { withUser } from "@/lib/db/client";
import { getPreferences } from "@/lib/data/notifications";
import { env, pushConfigured } from "@/lib/env";
import { pageContext } from "@/lib/server/context";
import { timeZoneOptions } from "@/lib/timezones";
import { ServiceWorkerRegistrar } from "@/components/app/ServiceWorker";
import { OnboardingWizard } from "./Wizard";

export const metadata: Metadata = { title: "Welcome" };

export default async function OnboardingPage() {
  const ctx = await pageContext({ allowUnonboarded: true });
  if (ctx.profile.onboarded_at) redirect("/");
  const prefs = await withUser(ctx.user.id, (tx) => getPreferences(tx, ctx.user.id));
  return (
    <main>
      <ServiceWorkerRegistrar />
      <OnboardingWizard
        name={ctx.profile.display_name || ""}
        currency={ctx.profile.currency}
        timeZone={ctx.profile.time_zone}
        tone={ctx.profile.tone}
        today={ctx.today}
        timeZones={timeZoneOptions(ctx.profile.time_zone)}
        vapidPublicKey={env().NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
        pushReady={pushConfigured()}
        defaultOffsets={prefs.default_offsets}
      />
    </main>
  );
}
