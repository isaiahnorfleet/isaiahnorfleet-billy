"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendCodeAction, verifyCodeAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";

export function SignInForm({ devMode }: { devMode: boolean }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (step === "email") {
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const res = await sendCodeAction(email);
            if (res.ok) setStep("code");
            else setError(res.error);
          });
        }}
      >
        <Field label="Email" htmlFor="email" error={error ?? undefined}>
          <Input id="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" invalid={!!error} />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? "Sending…" : "Email me a sign-in code"}
        </Button>
        <p className="text-sm text-muted">No password needed. We&apos;ll email you a one-time code.</p>
      </form>
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await verifyCodeAction(email, code);
          if (res.ok) {
            router.replace(res.next);
            router.refresh();
          } else setError(res.error);
        });
      }}
    >
      <p className="text-muted">
        {devMode ? "Development sign-in: enter any 6 digits." : <>We sent a code to <span className="font-semibold text-ivory">{email}</span>. It expires soon.</>}
      </p>
      <Field label="Sign-in code" htmlFor="code" error={error ?? undefined}>
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={10}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="tabular text-center text-2xl tracking-[0.4em]"
          invalid={!!error}
          autoFocus
        />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending || code.length < 6}>
        {pending ? "Checking…" : "Sign in"}
      </Button>
      <button type="button" className="w-full text-sm text-muted underline" onClick={() => { setStep("email"); setCode(""); setError(null); }}>
        Use a different email or resend
      </button>
    </form>
  );
}
