import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { problem, problems } from "@/lib/http/problem";
import { getOrder, getOrderByReference } from "@/lib/orders";
import { confirmPayment, markFailed } from "@/lib/payments";
import { PaystackError, verifyTransaction } from "@/lib/paystack";
import { createAdminClient } from "@/lib/supabase/clients";

export const dynamic = "force-dynamic";

const query = z.object({ reference: z.string().min(1, "is required").max(100, "is too long") });
const PRIVATE = { "Cache-Control": "private, no-store" };

/**
 * Called by /checkout/processing after Paystack redirects back. Asks Paystack
 * for the real outcome (the redirect alone proves nothing) and applies it.
 * Idempotent — the page polls it, and the webhook may get there first.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth = await getAuth(req);
  if (!auth) return problems.unauthorized(url.pathname);

  const parsed = query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return problems.badRequest(url.pathname, parsed.error);
  const { reference } = parsed.data;

  // RLS: only the order's owner can see it.
  const order = await getOrderByReference(auth.db, reference);
  if (!order) return problems.notFound(url.pathname, "No order with that payment reference.");
  if (order.status === "paid") return Response.json({ status: "paid", order }, { headers: PRIVATE });

  let tx;
  try {
    tx = await verifyTransaction(reference);
  } catch (err) {
    if (!(err instanceof PaystackError)) throw err;
    console.error("Paystack verify failed", { status: err.status });
    return problem({
      status: 502,
      type: "payment-provider-unavailable",
      title: "Payment provider unavailable",
      detail: "We couldn't check your payment yet. Please try again in a moment.",
      instance: url.pathname,
    });
  }

  const admin = createAdminClient();
  if (tx.status === "success") {
    const result = await confirmPayment(admin, tx);
    if (result.outcome !== "paid") {
      return problems.conflict(url.pathname, "This payment doesn't match the order. Contact us and quote your order number.");
    }
    return Response.json({ status: "paid", order: await getOrder(auth.db, order.id) }, { headers: PRIVATE });
  }

  if (tx.status === "failed" || tx.status === "reversed") {
    await markFailed(admin, order.id);
    return Response.json({ status: "failed", order: await getOrder(auth.db, order.id) }, { headers: PRIVATE });
  }

  // abandoned / ongoing / pending / queued: not finished yet.
  return Response.json({ status: "pending", order }, { headers: PRIVATE });
}
