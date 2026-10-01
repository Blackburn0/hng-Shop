import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { serverEnv } from "@/lib/env";

// Minimal Paystack client: https://paystack.com/docs/api/transaction/
// Amounts are in kobo, matching how orders store money.

export class PaystackError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PaystackError";
  }
}

const envelope = z.object({ status: z.boolean(), message: z.string(), data: z.unknown() });

const initializeData = z.object({ authorization_url: z.url(), access_code: z.string(), reference: z.string() });
const verifyData = z.object({
  status: z.string(), // success | failed | abandoned | ongoing | pending | reversed | queued
  reference: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  paid_at: z.string().nullable().optional(),
});
export type PaystackTransaction = z.infer<typeof verifyData>;

async function call<T extends z.ZodType>(path: string, init: RequestInit, schema: T): Promise<z.infer<T>> {
  const { PAYSTACK_BASE_URL, PAYSTACK_SECRET_KEY } = serverEnv();
  let res: Response;
  try {
    res = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new PaystackError(`Paystack unreachable: ${(err as Error).name}`);
  }
  const body: unknown = await res.json().catch(() => null);
  const outer = envelope.safeParse(body);
  const inner = outer.success ? schema.safeParse(outer.data.data) : undefined;
  if (!res.ok || !outer.success || !outer.data.status || !inner?.success) {
    const message = (body as { message?: string } | null)?.message ?? "unexpected response";
    throw new PaystackError(`Paystack ${path.split("?")[0]} failed: ${message}`, res.status);
  }
  return inner.data as z.infer<T>;
}

/** Unique, unguessable reference we generate and store before calling Paystack. */
export function newReference(): string {
  return `cs_${Date.now().toString(36)}_${randomBytes(9).toString("base64url")}`;
}

export function initializeTransaction(input: {
  email: string;
  amountMinor: number;
  reference: string;
  callbackUrl: string;
  orderId: string;
}) {
  return call(
    "/transaction/initialize",
    {
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        amount: input.amountMinor,
        currency: "NGN",
        reference: input.reference,
        callback_url: input.callbackUrl,
        channels: ["card", "bank", "ussd", "bank_transfer"],
        metadata: { order_id: input.orderId },
      }),
    },
    initializeData,
  );
}

export function verifyTransaction(reference: string) {
  return call(`/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET" }, verifyData);
}

/** Paystack signs webhook bodies with HMAC-SHA512 of the raw body using the secret key. */
export function isValidSignature(rawBody: string, signature: string | null): boolean {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", serverEnv().PAYSTACK_SECRET_KEY).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
