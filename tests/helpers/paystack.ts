import { createHmac } from "node:crypto";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { mailgun, mailgunHandlers } from "./mailgun";

// Fake Paystack and Mailgun (third-party services — the only things we mock).
// Supabase requests pass straight through to the real database.
const BASE = process.env.PAYSTACK_BASE_URL ?? "https://api.paystack.co";

type VerifyReply = { status: string; amount?: number; currency?: string; paid_at?: string | null } | "error";

export const paystack = {
  initializeCalls: [] as Record<string, unknown>[],
  verifyCalls: [] as string[],
  initializeFails: false,
  /** reference -> what verify should answer */
  verify: new Map<string, VerifyReply>(),
  /** amount the order was created with, so success replies can echo it */
  amounts: new Map<string, number>(),
  reset() {
    this.initializeCalls = [];
    this.verifyCalls = [];
    this.initializeFails = false;
    this.verify.clear();
    this.amounts.clear();
  },
};

export const externalServices = setupServer(
  ...mailgunHandlers,
  http.post(`${BASE}/transaction/initialize`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    paystack.initializeCalls.push(body);
    if (paystack.initializeFails) {
      return HttpResponse.json({ status: false, message: "Service unavailable" }, { status: 503 });
    }
    paystack.amounts.set(String(body.reference), Number(body.amount));
    return HttpResponse.json({
      status: true,
      message: "Authorization URL created",
      data: {
        authorization_url: `https://checkout.paystack.com/test-${String(body.reference)}`,
        access_code: "test-access-code",
        reference: body.reference,
      },
    });
  }),
  http.get(`${BASE}/transaction/verify/:reference`, ({ params }) => {
    const reference = String(params.reference);
    paystack.verifyCalls.push(reference);
    const reply = paystack.verify.get(reference) ?? { status: "abandoned" };
    if (reply === "error") return HttpResponse.json({ status: false, message: "Upstream error" }, { status: 500 });
    return HttpResponse.json({
      status: true,
      message: "Verification successful",
      data: {
        status: reply.status,
        reference,
        amount: reply.amount ?? paystack.amounts.get(reference) ?? 0,
        currency: reply.currency ?? "NGN",
        paid_at: reply.paid_at ?? (reply.status === "success" ? "2026-09-30T12:00:00.000Z" : null),
      },
    });
  }),
);

export { mailgun };

/**
 * Supabase passes through to the real database; any Paystack or Mailgun
 * request that no handler matches fails loudly instead of reaching the real
 * service with real keys.
 */
export const listenOptions: Parameters<typeof externalServices.listen>[0] = {
  onUnhandledRequest(request, print) {
    if (/(^|\.)(paystack\.co|mailgun\.net)$/.test(new URL(request.url).hostname)) print.error();
  },
};

export function sign(rawBody: string): string {
  return createHmac("sha512", process.env.PAYSTACK_SECRET_KEY!).update(rawBody).digest("hex");
}
