import { renderOrderConfirmation } from "@/lib/email/order-confirmation";
import { sendEmail } from "@/lib/email/mailgun";
import { publicEnv } from "@/lib/env";
import { getOrder } from "@/lib/orders";
import type { Db } from "@/lib/supabase/clients";
import { log } from "@/lib/log";

const TYPE = "order_confirmation";

export type EmailOutcome = "sent" | "already_sent" | "in_progress" | "failed" | "order_not_found";

/**
 * Send the confirmation email for an order at most once. `email_log` has a
 * unique (order_id, type) row that acts as the lock:
 *   - no row        -> insert 'queued' and send
 *   - 'failed' row  -> claim it back to 'queued' and retry
 *   - 'queued'/'sent' -> someone else sent it or is sending it; do nothing
 * Never throws: a mail outage must not fail an order. `admin` is the service role.
 */
export async function sendOrderConfirmation(admin: Db, orderId: string): Promise<EmailOutcome> {
  try {
    const claimed = await claim(admin, orderId);
    if (claimed !== "claimed") return claimed;

    const order = await getOrder(admin, orderId);
    if (!order) {
      await admin.from("email_log").delete().eq("order_id", orderId).eq("type", TYPE);
      return "order_not_found";
    }

    try {
      const email = renderOrderConfirmation(order, publicEnv().NEXT_PUBLIC_SITE_URL);
      const messageId = await sendEmail({ to: order.customerEmail, ...email, tag: "order-confirmation" });
      await admin
        .from("email_log")
        .update({ status: "sent", provider_message_id: messageId, error: null })
        .eq("order_id", orderId)
        .eq("type", TYPE);
      log.info("confirmation email sent", { orderId });
      return "sent";
    } catch (err) {
      // Keep the reason short and free of personal data.
      const reason = err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 300) : "unknown error";
      await admin.from("email_log").update({ status: "failed", error: reason }).eq("order_id", orderId).eq("type", TYPE);
      log.error("confirmation email failed", { orderId, reason });
      return "failed";
    }
  } catch (err) {
    log.error("confirmation email bookkeeping failed", { orderId, code: (err as { code?: string }).code });
    return "failed";
  }
}

async function claim(admin: Db, orderId: string): Promise<"claimed" | "already_sent" | "in_progress" | "order_not_found"> {
  const { error } = await admin.from("email_log").insert({ order_id: orderId, type: TYPE, status: "queued" });
  if (!error) return "claimed";
  if (error.code === "23503") return "order_not_found"; // foreign key: no such order
  if (error.code !== "23505") throw error;

  // A row exists. Retry only if the previous attempt failed — and only one caller wins the claim.
  const { data, error: claimError } = await admin
    .from("email_log")
    .update({ status: "queued", error: null })
    .eq("order_id", orderId)
    .eq("type", TYPE)
    .eq("status", "failed")
    .select("id");
  if (claimError) throw claimError;
  if (data.length > 0) return "claimed";

  const { data: row } = await admin.from("email_log").select("status").eq("order_id", orderId).eq("type", TYPE).single();
  return row?.status === "sent" ? "already_sent" : "in_progress";
}

/** Delivery status for the order page. */
export async function confirmationStatus(admin: Db, orderId: string): Promise<"sent" | "pending" | "failed" | null> {
  const { data } = await admin.from("email_log").select("status").eq("order_id", orderId).eq("type", TYPE).maybeSingle();
  if (!data) return null;
  return data.status === "sent" ? "sent" : data.status === "failed" ? "failed" : "pending";
}
