import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createOrder } from "@/app/api/v1/orders/route";
import { GET as verify } from "@/app/api/v1/payments/paystack/verify/route";
import { POST as webhook } from "@/app/api/v1/payments/paystack/webhook/route";
import { createClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import { escapeHtml, renderOrderConfirmation } from "@/lib/email/order-confirmation";
import { confirmationStatus, sendOrderConfirmation } from "@/lib/email/send-order-confirmation";
import type { Order } from "@/lib/orders";
import { admin, cleanup, createTestUser, fillCart, seededProduct, TAG, type TestUser, unknownId } from "./helpers/db";
import { request } from "./helpers/http";
import { externalServices, listenOptions, mailgun, paystack, sign } from "./helpers/paystack";

// Emails are a side effect of POST /api/v1/orders (cash), the verify endpoint
// and the webhook (card). Those endpoints' own status-code coverage lives in
// orders.test.ts and payments.test.ts; this file covers what gets sent, to
// whom, and that it's sent exactly once.

const SITE = "http://localhost:3000";
const delivery = { name: "Ada Lovelace", phone: "08012345678", address: "12 Marina Road, Lagos" };

const sample: Order = {
  id: "e01ddc11-1111-4222-8333-444455556666",
  status: "cash_on_delivery",
  paymentMethod: "cash",
  currency: "NGN",
  subtotalMinor: 1120000,
  totalMinor: 1120000,
  customerEmail: "ada@example.com",
  delivery: { name: "Ada <b>Lovelace</b>", phone: "0801 234 5678", address: "12 Marina & Co.\nLagos" },
  paidAt: null,
  createdAt: "2026-09-30T14:11:00Z",
  items: [
    { productId: null, productName: "Americano", unitPriceMinor: 350000, quantity: 2, lineTotalMinor: 700000 },
    { productId: null, productName: 'Cappuccino "Special"', unitPriceMinor: 420000, quantity: 1, lineTotalMinor: 420000 },
  ],
};

describe("renderOrderConfirmation", () => {
  const email = renderOrderConfirmation(sample, SITE);

  it("has a subject with the short order number", () => {
    expect(email.subject).toBe("Your Coffee Shop order #E01DDC11");
  });

  it("lists every item, the total and a link to the order", () => {
    for (const part of [email.html, email.text]) {
      expect(part).toContain("Americano");
      expect(part).toContain("₦7,000.00");
      expect(part).toContain("₦11,200.00");
      expect(part).toContain(`${SITE}/orders/${sample.id}`);
      expect(part).toContain("Cash on delivery");
    }
    expect(email.text).toContain("- Americano  2 x ₦3,500.00  = ₦7,000.00");
  });

  it("escapes customer-supplied text in the HTML", () => {
    expect(email.html).not.toContain("<b>Lovelace</b>");
    expect(email.html).toContain("Ada &lt;b&gt;Lovelace&lt;/b&gt;");
    expect(email.html).toContain("12 Marina &amp; Co.<br>Lagos");
    expect(email.html).toContain("Cappuccino &quot;Special&quot;");
    expect(email.text).toContain("Thank you, Ada!");
  });

  it("renders the phone as a white tel: link so Gmail can't recolour it on the dark card", () => {
    expect(email.html).toContain(
      '<a href="tel:08012345678" style="color:#ffffff;text-decoration:none;">0801 234 5678</a>',
    );
    expect(email.text).toContain("0801 234 5678");
  });

  it("uses card wording for paid card orders", () => {
    const card = renderOrderConfirmation({ ...sample, paymentMethod: "card", status: "paid" }, SITE);
    expect(card.text).toContain("Your payment was received");
    expect(card.text).toContain("Card via Paystack");
  });

  it("escapeHtml covers all five special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

let user: TestUser;
let americano: Tables<"products">;
let eventSeq = 0;

const placeOrder = async (paymentMethod: "card" | "cash") => {
  await fillCart(user, [{ productId: americano.id, quantity: 2 }]);
  const res = await createOrder(
    request("/api/v1/orders", { method: "POST", token: user.accessToken, body: { paymentMethod, delivery } }),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { order: { id: string }; payment: { reference: string } | null };
  return { id: body.order.id, reference: body.payment?.reference };
};

const verifyPayment = (reference: string) =>
  verify(request(`/api/v1/payments/paystack/verify?reference=${reference}`, { token: user.accessToken }));

const deliverWebhook = (reference: string) => {
  const raw = JSON.stringify({
    event: "charge.success",
    data: { id: `${TAG}-mail-${++eventSeq}`, reference, amount: 700000, currency: "NGN", paid_at: "2026-09-30T12:00:00.000Z" },
  });
  return webhook(
    new Request(`${SITE}/api/v1/payments/paystack/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-paystack-signature": sign(raw) },
      body: raw,
    }),
  );
};

async function logRow(orderId: string) {
  const { data } = await admin().from("email_log").select("status, provider_message_id, error").eq("order_id", orderId);
  return data ?? [];
}

beforeAll(async () => {
  externalServices.listen(listenOptions);
  [user, americano] = await Promise.all([createTestUser(), seededProduct("americano")]);
});
beforeEach(async () => {
  paystack.reset();
  mailgun.reset();
  await admin().from("orders").delete().eq("user_id", user.id);
});
afterAll(async () => {
  externalServices.close();
  await cleanup();
});

describe("order confirmation emails", () => {
  it("sends one confirmation for a cash order and records it", async () => {
    const { id } = await placeOrder("cash");

    const mails = mailgun.to(user.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({
      from: process.env.MAILGUN_FROM,
      subject: `Your Coffee Shop order #${id.slice(0, 8).toUpperCase()}`,
      tags: ["order-confirmation"],
    });
    expect(mails[0]!.html).toContain("₦7,000.00");
    expect(mails[0]!.text).toContain("Cash on delivery");
    expect(await logRow(id)).toEqual([{ status: "sent", provider_message_id: expect.stringMatching(/^mailgun:<test-/), error: null }]);
    expect(await confirmationStatus(admin(), id)).toBe("sent");
  });

  it("sends nothing when a card order is created, then once when it's paid", async () => {
    const { id, reference } = await placeOrder("card");
    expect(mailgun.sent).toEqual([]);
    expect(await confirmationStatus(admin(), id)).toBeNull();

    paystack.verify.set(reference!, { status: "success" });
    await verifyPayment(reference!);
    await verifyPayment(reference!); // page polling again
    await deliverWebhook(reference!); // Paystack's webhook arriving afterwards

    expect(mailgun.to(user.email)).toHaveLength(1);
    expect(mailgun.sent[0]!.text).toContain("Your payment was received");
  });

  it("sends exactly one email when verify and the webhook race", async () => {
    const { reference } = await placeOrder("card");
    paystack.verify.set(reference!, { status: "success" });

    await Promise.all([verifyPayment(reference!), deliverWebhook(reference!), deliverWebhook(reference!)]);

    expect(mailgun.to(user.email)).toHaveLength(1);
  });

  it("doesn't email for a pending or failed payment", async () => {
    const pending = await placeOrder("card");
    paystack.verify.set(pending.reference!, { status: "abandoned" });
    await verifyPayment(pending.reference!);

    const failed = await placeOrder("card");
    paystack.verify.set(failed.reference!, { status: "failed" });
    await verifyPayment(failed.reference!);

    expect(mailgun.sent).toEqual([]);
  });

  it("still creates the order when Mailgun is down, records the failure, and a retry sends it", async () => {
    mailgun.failNext = 1;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const { id } = await placeOrder("cash"); // 201 asserted inside

    expect(mailgun.sent).toEqual([]);
    expect(await logRow(id)).toEqual([
      { status: "failed", provider_message_id: null, error: expect.stringContaining("MailgunError: Mailgun 500") },
    ]);
    const reason = (await logRow(id))[0]!.error!;
    expect(reason).toContain("<email>"); // addresses in Mailgun's message are redacted
    expect(reason).not.toMatch(/@|sandbox[0-9a-f]+/);
    expect(await confirmationStatus(admin(), id)).toBe("failed");
    error.mockRestore();

    expect(await sendOrderConfirmation(admin(), id)).toBe("sent");
    expect(mailgun.to(user.email)).toHaveLength(1);
    expect(await confirmationStatus(admin(), id)).toBe("sent");
  });

  it("treats a Mailgun reply without a message id as a failure", async () => {
    mailgun.omitIdNext = 1;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const { id } = await placeOrder("cash");

    expect(await logRow(id)).toEqual([
      { status: "failed", provider_message_id: null, error: expect.stringContaining("did not accept") },
    ]);
    error.mockRestore();
  });

  it("returns failed instead of throwing when the database can't be reached", async () => {
    const unreachable = createClient<Database>("http://127.0.0.1:9", "unused-key", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await sendOrderConfirmation(unreachable, unknownId())).toBe("failed");
    expect(mailgun.sent).toEqual([]);
    error.mockRestore();
  });

  it("won't send twice when asked again after success", async () => {
    const { id } = await placeOrder("cash");

    expect(await sendOrderConfirmation(admin(), id)).toBe("already_sent");
    expect(mailgun.sent).toHaveLength(1);
  });

  it("doesn't send while another attempt is still in progress", async () => {
    const { id } = await placeOrder("card");
    await admin().from("email_log").insert({ order_id: id, type: "order_confirmation", status: "queued" });

    expect(await sendOrderConfirmation(admin(), id)).toBe("in_progress");
    expect(mailgun.sent).toEqual([]);
  });

  it("reports an unknown order without sending or throwing", async () => {
    expect(await sendOrderConfirmation(admin(), unknownId())).toBe("order_not_found");
    expect(mailgun.sent).toEqual([]);
  });
});
