import type { Metadata } from "next";
import { Suspense } from "react";
import { PaymentProcessing } from "@/components/PaymentProcessing";

export const metadata: Metadata = { title: "Confirming payment" };

// Design/Loading Page.png. Paystack redirects here with ?reference=…&trxref=…
export default function ProcessingPage() {
  return (
    <Suspense>
      <PaymentProcessing />
    </Suspense>
  );
}
