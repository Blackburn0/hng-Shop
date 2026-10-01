"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/Spinner";
import { pillOutline } from "@/components/ui";

type Phase = "checking" | "failed" | "slow" | "error";
const POLL_MS = 2500;
const MAX_ATTEMPTS = 12; // ~30 seconds

const messages: Record<Exclude<Phase, "checking">, string> = {
  failed: "Your payment didn't go through, so you haven't been charged. Your cart is still saved.",
  slow: "We're still waiting for Paystack to confirm your payment. You'll see it on your order page once it's through.",
  error: "We couldn't find that payment. If you were charged, contact us with your Paystack receipt.",
};

export function PaymentProcessing() {
  const params = useSearchParams();
  const router = useRouter();
  const reference = params.get("reference") ?? params.get("trxref");
  const [phase, setPhase] = useState<Phase>("checking");
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function check(attempt: number) {
      if (!reference) return setPhase("error");
      try {
        const res = await fetch(`/api/v1/payments/paystack/verify?reference=${encodeURIComponent(reference)}`);
        if (cancelled) return;
        if (res.status === 401) {
          // Full navigation: /auth/login redirects off-site to Google.
          const next = encodeURIComponent(location.pathname + location.search);
          return window.location.assign(new URL(`/auth/login?next=${next}`, location.origin).href);
        }
        if (res.status === 404 || res.status === 409) return setPhase("error");
        if (res.ok) {
          const body = (await res.json()) as { status: string; order: { id: string } };
          setOrderId(body.order.id);
          if (body.status === "paid") return router.replace(`/orders/${body.order.id}`);
          if (body.status === "failed") return setPhase("failed");
        }
      } catch {
        // network blip — keep polling
      }
      if (attempt + 1 >= MAX_ATTEMPTS) return setPhase("slow");
      timer = setTimeout(() => void check(attempt + 1), POLL_MS);
    }

    void check(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reference, router]);

  return (
    <section className="py-8 md:py-12">
      <div className="relative isolate grid min-h-[560px] place-items-center overflow-hidden md:min-h-[880px]">
        <Image src="/hero.jpg" alt="" fill priority sizes="100vw" className="-z-10 object-cover" />

        <div className="flex w-full flex-col items-center gap-8 bg-espresso/60 px-6 py-14 text-paper md:flex-row md:justify-center md:gap-14 md:py-24">
          {phase === "checking" ? (
            <Spinner size={300} className="hidden md:block" />
          ) : null}
          {phase === "checking" ? <Spinner size={140} className="md:hidden" /> : null}

          <div className="max-w-xl text-center md:text-left">
            <h1 className="font-display text-4xl font-bold leading-tight md:text-[4rem] md:leading-[1.3]">
              {phase === "failed" ? (
                "Payment not completed"
              ) : (
                <>
                  One Step
                  <br />
                  Closer to
                  <br />
                  Your Doorstep
                </>
              )}
            </h1>

            <p role="status" aria-live="polite" className="mt-6 text-lg md:text-xl">
              {phase === "checking" ? "Confirming your payment with Paystack…" : messages[phase]}
            </p>

            {phase !== "checking" && (
              <div className="mt-8 flex flex-wrap justify-center gap-4 md:justify-start">
                {phase === "failed" && (
                  <Link href="/checkout" className={`${pillOutline} h-14 text-xl`}>
                    Try again
                  </Link>
                )}
                {orderId && phase === "slow" && (
                  <Link href={`/orders/${orderId}`} className={`${pillOutline} h-14 text-xl`}>
                    View order
                  </Link>
                )}
                <Link href="/products" className={`${pillOutline} h-14 text-xl`}>
                  <span aria-hidden="true">&lt;</span> Back to Order
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
