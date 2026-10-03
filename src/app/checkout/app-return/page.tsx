import type { Metadata } from "next";

export const metadata: Metadata = { title: "Return to the app" };

// Paystack's callback for payments started in the mobile app
// (POST /api/v1/orders with returnTo: "app"). This browser tab has no web
// session, so it doesn't look anything up: the app confirms the payment itself
// (GET /api/v1/payments/paystack/verify) as soon as the user is back in it.
export default function AppReturnPage() {
  return (
    <section className="grid min-h-[60vh] place-items-center px-4 py-16">
      <div className="max-w-md rounded-[2rem] bg-espresso px-8 py-12 text-center text-paper">
        <h1 className="font-display text-3xl font-bold md:text-4xl">Payment submitted</h1>
        <p className="mt-4 text-lg">
          Close this window and go back to the <strong>Coffee Shop</strong> app. It will confirm your payment and show
          your order.
        </p>
      </div>
    </section>
  );
}
