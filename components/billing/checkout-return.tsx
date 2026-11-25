"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CircleCheck, LoaderCircle } from "lucide-react";

/** How long to wait for Stripe's webhook before saying so. */
const WAIT_MS = 60_000;
const POLL_MS = 2_000;
/** Long enough to read "Payment received" before moving on. */
const REDIRECT_DELAY_MS = 1_200;

/**
 * Shown on the billing page right after checkout when the payment couldn't be
 * confirmed on the way back. Refreshes until the plan is active (`ready`),
 * then moves on to adding a keyword.
 */
export function CheckoutReturn({ ready }: { ready: boolean }) {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (ready) {
      const timer = setTimeout(() => router.replace("/app/new?welcome=1"), REDIRECT_DELAY_MS);
      return () => clearTimeout(timer);
    }
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > WAIT_MS) {
        clearInterval(timer);
        setTimedOut(true);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [ready, router]);

  return (
    <div role="status" className="flex items-start gap-3 rounded-2xl border border-line bg-good-soft p-4 text-sm text-good">
      {ready ? (
        <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
      )}
      <p>
        {ready
          ? "Payment received. Your credits are ready. Taking you to add your first keyword…"
          : timedOut
            ? "Payment received. Your credits are still on the way from Stripe and will show up here shortly."
            : "Payment received. Setting up your credits…"}{" "}
        {timedOut ? (
          <Link href="/app/new" className="font-semibold underline underline-offset-2">
            Add a keyword
          </Link>
        ) : null}
      </p>
    </div>
  );
}
