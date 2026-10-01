import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { problem, problems } from "@/lib/http/problem";
import { confirmPayment } from "@/lib/payments";
import { isValidSignature } from "@/lib/paystack";
import { createAdminClient } from "@/lib/supabase/clients";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

const event = z.object({
  event: z.string(),
  data: z
    .object({
      id: z.union([z.number(), z.string()]),
      reference: z.string().optional(),
      status: z.string().optional(),
      amount: z.number().int().optional(),
      currency: z.string().optional(),
      paid_at: z.string().nullable().optional(),
    })
    .loose(),
});

/**
 * Paystack webhook. Verifies the HMAC signature, records the event once, and
 * applies charge.success. Returns 200 for anything we've handled (or chosen to
 * ignore) so Paystack stops retrying; 5xx only for our own failures.
 */
export async function POST(req: Request) {
  const { pathname } = new URL(req.url);

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return tooLarge(pathname);
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return tooLarge(pathname);

  if (!isValidSignature(raw, req.headers.get("x-paystack-signature"))) {
    return problem({ status: 401, type: "invalid-signature", title: "Invalid webhook signature", instance: pathname });
  }

  let payload: z.infer<typeof event>;
  try {
    const parsed = event.safeParse(JSON.parse(raw));
    if (!parsed.success) return problems.validation(pathname, parsed.error);
    payload = parsed.data;
  } catch {
    return problems.malformedJson(pathname);
  }

  const admin = createAdminClient();
  const { error: insertError } = await admin.from("payment_events").insert({
    provider: "paystack",
    event_id: `${payload.event}:${payload.data.id}`,
    event_type: payload.event,
    reference: payload.data.reference ?? null,
    payload: JSON.parse(raw) as Json,
  });
  if (insertError) {
    if (insertError.code === "23505") return Response.json({ received: true, duplicate: true });
    console.error("payment_events insert failed", insertError.code);
    return problems.internal(pathname);
  }

  const { data } = payload;
  if (payload.event === "charge.success" && data.reference && data.amount !== undefined && data.currency) {
    await confirmPayment(admin, {
      status: "success",
      reference: data.reference,
      amount: data.amount,
      currency: data.currency,
      paid_at: data.paid_at ?? null,
    });
  }

  return Response.json({ received: true });
}

function tooLarge(instance: string) {
  return problem({ status: 413, type: "payload-too-large", title: "Payload too large", instance });
}
