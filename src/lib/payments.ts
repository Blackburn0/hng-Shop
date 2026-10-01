import { sendOrderConfirmation } from "@/lib/email/send-order-confirmation";
import { dbHint } from "@/lib/orders";
import type { PaystackTransaction } from "@/lib/paystack";
import type { Db } from "@/lib/supabase/clients";

export type ConfirmResult =
  | { outcome: "paid"; orderId: string; transitioned: boolean }
  | { outcome: "amount_mismatch" | "order_not_found" };

/**
 * Apply a successful Paystack transaction to its order. Safe to call from the
 * verify endpoint and the webhook concurrently: only one call transitions.
 * `admin` must be the service-role client.
 */
export async function confirmPayment(admin: Db, tx: PaystackTransaction): Promise<ConfirmResult> {
  const { data, error } = await admin.rpc("mark_order_paid", {
    p_reference: tx.reference,
    p_amount_minor: tx.amount,
    p_currency: tx.currency,
    p_paid_at: tx.paid_at ?? null,
  });
  if (error) {
    const hint = dbHint(error);
    if (hint === "amount_mismatch" || hint === "order_not_found") {
      console.error("payment not applied", { reference: tx.reference, reason: hint });
      return { outcome: hint };
    }
    throw error;
  }
  const row = data[0]!;
  if (row.transitioned) {
    console.info("order paid", { orderId: row.order_id });
    await sendOrderConfirmation(admin, row.order_id);
  }
  return { outcome: "paid", orderId: row.order_id, transitioned: row.transitioned };
}

/** Mark a pending card order failed (Paystack said failed/abandoned, or init failed). */
export async function markFailed(admin: Db, orderId: string): Promise<void> {
  const { error } = await admin.from("orders").update({ status: "failed" }).eq("id", orderId).eq("status", "pending_payment");
  if (error) throw error;
}
