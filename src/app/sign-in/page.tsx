import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BillyMascot } from "@/components/billy/BillyMascot";
import { Wordmark } from "@/components/ui/Wordmark";
import { getSessionUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ signed_out?: string; link?: string }> }) {
  if (await getSessionUser()) redirect("/");
  const { signed_out, link } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 flex items-end gap-4">
        <BillyMascot mood={signed_out ? "all_clear" : "neutral"} size={92} />
        <div className="pb-2">
          <Wordmark className="text-5xl" />
          <p className="mt-1 font-display text-lg font-bold text-muted">Your bills. Handled.</p>
        </div>
      </div>
      {link === "expired" && <p className="mb-4 rounded-xl border border-peach/50 bg-peach/10 p-3 text-sm text-peach">That sign-in link didn&apos;t work or has expired. Request a new code below.</p>}
      {signed_out && <p className="mb-4 rounded-xl border border-line bg-panel p-3 text-sm">You&apos;re signed out. See you soon.</p>}
      <h1 className="mb-4 text-2xl font-bold">Sign in</h1>
      <SignInForm devMode={env().AUTH_MODE === "dev"} />
      <p className="mt-8 text-center text-sm text-muted">
        Just looking? <Link href="/demo" className="text-lime underline">See a demo with sample bills</Link>
      </p>
    </main>
  );
}
