import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createOrder } from "@/app/api/v1/orders/route";
import { GET as verify } from "@/app/api/v1/payments/paystack/verify/route";
import { POST as webhook } from "@/app/api/v1/payments/paystack/webhook/route";
import type { Tables } from "@/lib/database.types";
import {
  admin,
  cartRows,
  cleanup,
  createTestUser,
  fillCart,
  orderRow,
  seededProduct,
  TAG,
  type TestUser,
} from "./helpers/db";
import { expectProblem, request } from "./helpers/http";
import { externalServices, listenOptions, mailgun, paystack, sign } from "./helpers/paystack";

const VERIFY = "/api/v1/payments/paystack/verify";
const HOOK = "/api/v1/payments/paystack/webhook";
const delivery = { name: "Ada Lovelace", phone: "08012345678", address: "12 Marina Road, Lagos" };

let alice: TestUser;
let bob: TestUser;
let americano: Tables<"products">;
let cappuccino: Tables<"products">;
let eventSeq = 0;

/** A fresh pending card order for alice (cart: 2 x Americano = ₦7,000). */
async function cardOrder() {
  await fillCart(alice, [{ productId: americano.id, quantity: 2 }]);
  const res = await createOrder(
    request("/api/v1/orders", { method: "POST", token: alice.accessToken, body: { paymentMethod: "card", delivery } }),
  );
  const body = (await res.json()) as { order: { id: string }; payment: { reference: string } };
  return { id: body.order.id, reference: body.payment.reference };
}

const check = (user: TestUser | null, reference?: string) =>
  verify(request(`${VERIFY}${reference === undefined ? "" : `?reference=${encodeURIComponent(reference)}`}`, { token: user?.accessToken }));

function hook(payload: unknown, { signature, raw }: { signature?: string | null; raw?: string } = {}) {
  const body = raw ?? JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sig = signature === undefined ? sign(body) : signature;
  if (sig) headers["x-paystack-signature"] = sig;
  return webhook(new Request(`http://localhost:3000${HOOK}`, { method: "POST", headers, body }));
}

const chargeSuccess = (reference: string, amount = 700000, currency = "NGN") => ({
  event: "charge.success",
  data: { id: `${TAG}-${++eventSeq}`, reference, amount, currency, status: "success", paid_at: "2026-09-30T12:00:00.000Z" },
});

beforeAll(async () => {
  externalServices.listen(listenOptions);
  [alice, bob, americano, cappuccino] = await Promise.all([
    createTestUser(),
    createTestUser(),
    seededProduct("americano"),
    seededProduct("cappuccino"),
  ]);
});
beforeEach(async () => {
  paystack.reset();
  mailgun.reset();
  await admin().from("orders").delete().in("user_id", [alice.id, bob.id]);
});
afterAll(async () => {
  externalServices.close();
  await cleanup();
});

describe("GET /api/v1/payments/paystack/verify", () => {
  it("returns 401 without a session", async () => {
    await expectProblem(await check(null, "cs_x"), 401, VERIFY);
  });

  it("returns 400 when reference is missing", async () => {
    const body = await expectProblem(await check(alice), 400, VERIFY);
    expect(body.errors?.[0]?.field).toBe("reference");
  });

  it("returns 404 for an unknown reference", async () => {
    await expectProblem(await check(alice, "cs_unknown"), 404, VERIFY);
  });

  it("returns 404 for someone else's payment reference", async () => {
    const { reference } = await cardOrder();
    await expectProblem(await check(bob, reference), 404, VERIFY);
    expect(paystack.verifyCalls).toEqual([]);
  });

  it("reports pending while the customer hasn't finished paying", async () => {
    const { id, reference } = await cardOrder();
    paystack.verify.set(reference, { status: "abandoned" });

    const res = await check(alice, reference);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "pending", order: { id, status: "pending_payment" } });
  });

  it("marks the order paid on success and removes the bought items from the cart", async () => {
    const { id, reference } = await cardOrder();
    await admin().from("cart_items").insert({ user_id: alice.id, product_id: cappuccino.id, quantity: 1 }); // added after checkout
    paystack.verify.set(reference, { status: "success" });

    const res = await check(alice, reference);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "paid", order: { id, status: "paid", paidAt: expect.any(String) } });
    expect(await orderRow(id)).toMatchObject({ status: "paid" });
    expect(await cartRows(alice)).toEqual([{ product_id: cappuccino.id, quantity: 1 }]);
  });

  it("is idempotent — once paid it answers without asking Paystack again", async () => {
    const { reference } = await cardOrder();
    paystack.verify.set(reference, { status: "success" });
    await check(alice, reference);

    const again = await check(alice, reference);

    expect(await again.json()).toMatchObject({ status: "paid" });
    expect(paystack.verifyCalls).toEqual([reference]);
  });

  it("returns 409 and leaves the order unpaid when the amount doesn't match", async () => {
    const { id, reference } = await cardOrder();
    paystack.verify.set(reference, { status: "success", amount: 100 });

    await expectProblem(await check(alice, reference), 409, VERIFY);
    expect((await orderRow(id)).status).toBe("pending_payment");
  });

  it("returns 409 when the currency doesn't match", async () => {
    const { id, reference } = await cardOrder();
    paystack.verify.set(reference, { status: "success", currency: "USD" });

    await expectProblem(await check(alice, reference), 409, VERIFY);
    expect((await orderRow(id)).status).toBe("pending_payment");
  });

  it("marks the order failed when Paystack reports a failed charge, keeping the cart", async () => {
    const { id, reference } = await cardOrder();
    paystack.verify.set(reference, { status: "failed" });

    const res = await check(alice, reference);

    expect(await res.json()).toMatchObject({ status: "failed", order: { id, status: "failed" } });
    expect(await cartRows(alice)).toHaveLength(1);
  });

  it("returns 502 when Paystack can't be reached", async () => {
    const { id, reference } = await cardOrder();
    paystack.verify.set(reference, "error");

    await expectProblem(await check(alice, reference), 502, VERIFY);
    expect((await orderRow(id)).status).toBe("pending_payment");
  });
});

describe("POST /api/v1/payments/paystack/webhook", () => {
  it.each([
    ["missing", null],
    ["wrong", "0".repeat(128)],
    ["malformed", "not-hex"],
  ])("returns 401 for a %s signature", async (_, signature) => {
    await expectProblem(await hook(chargeSuccess("cs_x"), { signature }), 401, HOOK);
  });

  it("returns 413 for an oversized body", async () => {
    await expectProblem(await hook(null, { raw: "x".repeat(70 * 1024) }), 413, HOOK);
  });

  it("returns 400 for signed but malformed JSON", async () => {
    await expectProblem(await hook(null, { raw: "{nope" }), 400, HOOK);
  });

  it("returns 422 for signed JSON of the wrong shape", async () => {
    await expectProblem(await hook({ hello: "world" }), 422, HOOK);
  });

  it("applies charge.success: order paid, event stored once", async () => {
    const { id, reference } = await cardOrder();
    const event = chargeSuccess(reference);

    const res = await hook(event);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(await orderRow(id)).toMatchObject({ status: "paid", paid_at: expect.stringContaining("2026-09-30") });
    const { data } = await admin().from("payment_events").select("event_type, reference").eq("event_id", `charge.success:${event.data.id}`);
    expect(data).toEqual([{ event_type: "charge.success", reference }]);
  });

  it("acknowledges a redelivered event without processing it twice", async () => {
    const { reference } = await cardOrder();
    const event = chargeSuccess(reference);
    await hook(event);

    const again = await hook(event);

    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ received: true, duplicate: true });
    const { count } = await admin()
      .from("payment_events")
      .select("*", { count: "exact", head: true })
      .eq("event_id", `charge.success:${event.data.id}`);
    expect(count).toBe(1);
  });

  it("ignores a charge for an unknown reference (200, no retry)", async () => {
    const res = await hook(chargeSuccess(`cs_${TAG}_unknown`));
    expect(res.status).toBe(200);
  });

  it("doesn't mark paid when the amount is wrong", async () => {
    const { id, reference } = await cardOrder();
    const res = await hook(chargeSuccess(reference, 1));

    expect(res.status).toBe(200);
    expect((await orderRow(id)).status).toBe("pending_payment");
  });

  it("stores other events without touching orders", async () => {
    const { id } = await cardOrder();
    const res = await hook({ event: "transfer.success", data: { id: `${TAG}-${++eventSeq}` } });

    expect(res.status).toBe(200);
    expect((await orderRow(id)).status).toBe("pending_payment");
  });

  it("with verify racing the webhook, the order transitions exactly once", async () => {
    const { id, reference } = await cardOrder();
    paystack.verify.set(reference, { status: "success" });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const [a, b] = await Promise.all([check(alice, reference), hook(chargeSuccess(reference))]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((await orderRow(id)).status).toBe("paid");
    expect(info.mock.calls.filter(([msg]) => msg === "order paid")).toHaveLength(1);
    info.mockRestore();
  });
});
