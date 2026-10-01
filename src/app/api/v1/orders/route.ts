import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { sendOrderConfirmation } from "@/lib/email/send-order-confirmation";
import { publicEnv } from "@/lib/env";
import { problem, problems, readJson } from "@/lib/http/problem";
import { createOrderBody, dbHint, getOrder, listOrders, orderCursor } from "@/lib/orders";
import { cursorParam, limitParam } from "@/lib/pagination";
import { markFailed } from "@/lib/payments";
import { initializeTransaction, newReference, PaystackError } from "@/lib/paystack";
import { createAdminClient } from "@/lib/supabase/clients";
import { route } from "@/lib/http/route";
import { LIMITS } from "@/lib/http/rate-limit";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store" };

/**
 * Create an order from the caller's cart. Prices come from the products table,
 * never the client. Card orders return a Paystack checkout URL; cash orders are
 * confirmed immediately.
 */
export const POST = route({ rateLimit: { bucket: "orders.create", ...LIMITS.checkout } }, async (req: Request) => {
  const { pathname } = new URL(req.url);
  const auth = await getAuth(req);
  if (!auth) return problems.unauthorized(pathname);

  const json = await readJson(req);
  if (!json.ok) return json.error;
  const body = createOrderBody.safeParse(json.value);
  if (!body.success) return problems.validation(pathname, body.error);

  const email = auth.user.email;
  if (!email) {
    return problem({
      status: 422,
      type: "validation-error",
      title: "Request validation failed",
      detail: "Your account has no email address, which is needed for the receipt.",
      instance: pathname,
      errors: [{ field: "email", message: "is required on the account" }],
    });
  }

  const { paymentMethod, delivery } = body.data;
  const admin = createAdminClient();
  const reference = paymentMethod === "card" ? newReference() : null;

  const { data: row, error } = await admin.rpc("create_order", {
    p_user_id: auth.user.id,
    p_email: email,
    p_payment_method: paymentMethod,
    p_delivery_name: delivery.name,
    p_delivery_phone: delivery.phone,
    p_delivery_address: delivery.address,
    p_paystack_reference: reference,
  });
  if (error) {
    if (dbHint(error) === "empty_cart") {
      return problems.conflict(pathname, "Your cart is empty — add something before checking out.");
    }
    log.error("create_order failed", { code: error.code });
    return problems.internal(pathname);
  }

  const order = (await getOrder(admin, row.id))!;
  const headers = { ...PRIVATE, Location: `/api/v1/orders/${order.id}` };

  if (paymentMethod === "cash") {
    await sendOrderConfirmation(admin, order.id); // never throws
    return Response.json({ order, payment: null, next: `/orders/${order.id}` }, { status: 201, headers });
  }

  try {
    const tx = await initializeTransaction({
      email,
      amountMinor: order.totalMinor,
      reference: reference!,
      callbackUrl: new URL("/checkout/processing", publicEnv().NEXT_PUBLIC_SITE_URL).toString(),
      orderId: order.id,
    });
    return Response.json(
      { order, payment: { provider: "paystack", reference, authorizationUrl: tx.authorization_url }, next: tx.authorization_url },
      { status: 201, headers },
    );
  } catch (err) {
    if (!(err instanceof PaystackError)) throw err;
    log.error("Paystack initialize failed", { orderId: order.id, status: err.status });
    await markFailed(admin, order.id);
    return problem({
      status: 502,
      type: "payment-provider-unavailable",
      title: "Payment provider unavailable",
      detail: "We couldn't start the payment. Your cart is unchanged — please try again.",
      instance: pathname,
    });
  }
});

const listQuery = z.object({ limit: limitParam, cursor: cursorParam(orderCursor).optional() });

/** The caller's orders, newest first. */
export const GET = route({ rateLimit: { bucket: "orders.read", ...LIMITS.user } }, async (req: Request) => {
  const url = new URL(req.url);
  const auth = await getAuth(req);
  if (!auth) return problems.unauthorized(url.pathname);

  const parsed = listQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return problems.badRequest(url.pathname, parsed.error);

  try {
    return Response.json(await listOrders(auth.db, auth.user.id, parsed.data), { headers: PRIVATE });
  } catch (err) {
    log.error("GET /api/v1/orders failed", { err });
    return problems.internal(url.pathname);
  }
});
