"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LoaderCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const inputClasses =
  "h-12 w-full rounded-full border border-line bg-white px-5 text-base text-ink placeholder:text-ink-soft focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft disabled:opacity-60";

type Step = "email" | "code";

/** Two-step passwordless sign-in: email -> 6-digit code. `next` is where to go afterwards. */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function sendCode(address: string): Promise<boolean> {
    const supabase = createClient();
    const emailRedirectTo = `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}`;
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo, shouldCreateUser: true },
    });
    if (otpError) {
      setError(otpError.message);
      return false;
    }
    return true;
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address) return;
    setEmail(address);
    setBusy(true);
    setError(null);
    setNotice(null);
    const sent = await sendCode(address);
    setBusy(false);
    if (sent) {
      setCode("");
      setStep("code");
    }
  }

  async function handleResend() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const sent = await sendCode(email);
    setBusy(false);
    if (sent) setNotice("We sent a new code. Check your inbox.");
  }

  async function handleCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = code.replace(/\D/g, "");
    if (token.length !== 6) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    if (verifyError) {
      setError(verifyError.message);
      setBusy(false);
      return;
    }
    // Keep the button in its busy state while the app loads.
    router.replace(next);
    router.refresh();
  }

  function switchEmail() {
    setStep("email");
    setCode("");
    setError(null);
    setNotice(null);
  }

  if (step === "email") {
    return (
      <form onSubmit={handleEmailSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-ink">
            Email
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            className={inputClasses}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy || !email.trim()} className="w-full">
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          {busy ? "Sending" : "Send me a code"}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleCodeSubmit} className="space-y-4" noValidate>
      <p className="text-sm text-ink-muted">
        We emailed a 6-digit code to <span className="font-semibold text-ink">{email}</span>. Enter it
        below, or click the link in the email.
      </p>
      <div>
        <label htmlFor="login-code" className="mb-1.5 block text-sm font-medium text-ink">
          6-digit code
        </label>
        <input
          id="login-code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          autoFocus
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          disabled={busy}
          className={`${inputClasses} text-center text-lg tracking-[0.3em]`}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-good">
          {notice}
        </p>
      ) : null}
      <Button type="submit" disabled={busy || code.length !== 6} className="w-full">
        {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        {busy ? "Signing in" : "Sign in"}
      </Button>
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={handleResend}
          disabled={busy}
          className="font-medium text-brand hover:text-brand-strong disabled:opacity-50"
        >
          Resend code
        </button>
        <button
          type="button"
          onClick={switchEmail}
          disabled={busy}
          className="text-ink-muted hover:text-ink disabled:opacity-50"
        >
          Use a different email
        </button>
      </div>
    </form>
  );
}
