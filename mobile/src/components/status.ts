import type { OrderStatus } from "@/lib/api";

// Same wording as the website's order page (src/app/orders/[id]/page.tsx).
export const STATUS: Record<OrderStatus, { badge: string; heading: string; body: string; good: boolean }> = {
  paid: { badge: "Paid", heading: "Thank you", body: "Your payment was received and your order is being prepared.", good: true },
  cash_on_delivery: {
    badge: "Pay on delivery",
    heading: "Thank you",
    body: "Your order is confirmed. Please have the exact amount ready when it arrives.",
    good: true,
  },
  pending_payment: {
    badge: "Awaiting payment",
    heading: "Almost there",
    body: "We haven't received confirmation from Paystack yet.",
    good: false,
  },
  failed: {
    badge: "Payment failed",
    heading: "Payment not completed",
    body: "You haven't been charged. Your cart is saved, so you can try again.",
    good: false,
  },
  cancelled: { badge: "Cancelled", heading: "Order cancelled", body: "This order was cancelled.", good: false },
};

export const orderNumber = (id: string) => id.slice(0, 8).toUpperCase();

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
