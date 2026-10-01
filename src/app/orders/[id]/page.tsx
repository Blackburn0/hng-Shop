import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { pillOutline } from "@/components/ui";
import type { Enums } from "@/lib/database.types";
import { confirmationStatus } from "@/lib/email/send-order-confirmation";
import { createAdminClient } from "@/lib/supabase/clients";
import { formatMoney } from "@/lib/money";
import { getOrder } from "@/lib/orders";
import { createServerComponentClient, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your order" };

const statusCopy: Record<Enums<"order_status">, { badge: string; heading: string; body: string }> = {
  paid: {
    badge: "Paid",
    heading: "Thank you",
    body: "Your payment was received and your order is being prepared.",
  },
  cash_on_delivery: {
    badge: "Pay on delivery",
    heading: "Thank you",
    body: "Your order is confirmed. Please have the exact amount ready when it arrives.",
  },
  pending_payment: {
    badge: "Awaiting payment",
    heading: "Almost there",
    body: "We haven't received confirmation from Paystack yet. This page updates once it arrives.",
  },
  failed: {
    badge: "Payment failed",
    heading: "Payment not completed",
    body: "You haven't been charged. Your cart is saved, so you can try again.",
  },
  cancelled: { badge: "Cancelled", heading: "Order cancelled", body: "This order was cancelled." },
};

const dateFmt = new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });

// Not in the Figma file — designed in the same style (plan.md D7).
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/orders/${id}`)}`);

  // RLS: another user's order is simply not found.
  const order = await getOrder(await createServerComponentClient(), id);
  if (!order) notFound();

  // email_log is service-role only; the order was already authorised above via RLS.
  const emailStatus = await confirmationStatus(createAdminClient(), order.id);
  const copy = statusCopy[order.status];
  const firstName = order.delivery.name.split(/\s+/)[0];
  const orderNo = order.id.slice(0, 8).toUpperCase();
  const good = order.status === "paid" || order.status === "cash_on_delivery";

  return (
    <section className="mx-auto max-w-[1184px] px-4 py-12 sm:px-8 md:py-20">
      <div className="flex flex-col items-center text-center">
        <div
          className={`grid size-20 place-items-center rounded-full ${good ? "bg-espresso text-paper" : "border-4 border-espresso text-espresso"}`}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" className="size-10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            {good ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M12 7v6m0 4h.01" />}
          </svg>
        </div>
        <h1 className="mt-6 font-display text-4xl font-bold md:text-6xl">
          {copy.heading}
          {good ? `, ${firstName}!` : ""}
        </h1>
        <p className="mt-4 max-w-xl text-lg md:text-xl">{copy.body}</p>
        <p className="mt-6 flex flex-wrap items-center justify-center gap-3 text-base">
          <span className="font-bold">Order #{orderNo}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={order.createdAt}>{dateFmt.format(new Date(order.createdAt))}</time>
          <span className="rounded-full bg-espresso px-4 py-1 text-sm font-bold text-paper">{copy.badge}</span>
        </p>
        {good && emailStatus && (
          <p className="mt-2 text-sm opacity-75">
            {
              {
                sent: `A confirmation has been sent to ${order.customerEmail}.`,
                pending: `We're sending a confirmation to ${order.customerEmail}.`,
                failed: `We couldn't email your confirmation to ${order.customerEmail} — this page is your receipt.`,
              }[emailStatus]
            }
          </p>
        )}
      </div>

      <div className="mt-14 grid gap-10 lg:grid-cols-[1fr_360px]">
        <div>
          <h2 className="border-b-[1.5px] border-ink pb-2 font-body text-3xl font-extrabold">Order summary</h2>
          <ul>
            {order.items.map((item) => (
              <li key={`${item.productName}-${item.unitPriceMinor}`} className="flex items-baseline justify-between gap-4 border-b border-ink/20 py-5 text-xl">
                <span>
                  <span className="font-extrabold">{item.productName}</span>
                  <span className="ml-3 opacity-75">
                    {item.quantity} × {formatMoney(item.unitPriceMinor, order.currency)}
                  </span>
                </span>
                <span className="tabular-nums">{formatMoney(item.lineTotalMinor, order.currency)}</span>
              </li>
            ))}
          </ul>
          <p className="flex items-baseline justify-end gap-6 pt-6">
            <span className="font-body text-3xl font-extrabold">Total:</span>
            <span className="text-3xl tabular-nums">{formatMoney(order.totalMinor, order.currency)}</span>
          </p>
        </div>

        <aside className="h-fit rounded-[2.5rem] bg-espresso px-8 py-9 text-paper">
          <h2 className="font-body text-3xl font-extrabold">Delivery</h2>
          <address className="mt-4 whitespace-pre-line text-lg not-italic leading-relaxed">
            {order.delivery.name}
            {"\n"}
            {order.delivery.phone}
            {"\n"}
            {order.delivery.address}
          </address>
          <h2 className="mt-8 font-body text-3xl font-extrabold">Payment</h2>
          <p className="mt-3 text-lg">{order.paymentMethod === "card" ? "Card via Paystack" : "Cash on delivery"}</p>
          {order.paidAt && (
            <p className="text-sm opacity-80">Paid {dateFmt.format(new Date(order.paidAt))}</p>
          )}
        </aside>
      </div>

      <div className="mt-14 flex flex-wrap justify-center gap-4">
        {order.status === "failed" && (
          <Link href="/checkout" className={`${pillOutline} h-14 text-xl md:text-2xl`}>
            Try again
          </Link>
        )}
        <Link href="/products" className={`${pillOutline} h-14 min-w-80 text-xl md:text-2xl`}>
          <span aria-hidden="true">&lt;</span> Continue shopping
        </Link>
      </div>
    </section>
  );
}
