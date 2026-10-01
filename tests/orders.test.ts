import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getOrder } from "@/app/api/v1/orders/[id]/route";
import { GET as listOrders, POST as createOrder } from "@/app/api/v1/orders/route";
import type { Tables } from "@/lib/database.types";
import {
  admin,
  cartRows,
  cleanup,
  createTestProduct,
  createTestUser,
  fillCart,
  orderRow,
  seededProduct,
  type TestUser,
  unknownId,
} from "./helpers/db";
import { expectProblem, params, request } from "./helpers/http";
import { externalServices, listenOptions, mailgun, paystack } from "./helpers/paystack";

const PATH = "/api/v1/orders";
const delivery = { name: "Ada Lovelace", phone: "0801 234 5678", address: "12 Marina Road, Lagos" };

let alice: TestUser;
let bob: TestUser;
let americano: Tables<"products">;
let cappuccino: Tables<"products">;

type OrderBody = {
  order: {
    id: string;
    status: string;
    paymentMethod: string;
    totalMinor: number;
    subtotalMinor: number;
    currency: string;
    customerEmail: string;
    delivery: typeof delivery;
    items: { productName: string; unitPriceMinor: number; quantity: number; lineTotalMinor: number }[];
  };
  payment: { provider: string; reference: string; authorizationUrl: string } | null;
  next: string;
};

const post = (user: TestUser | null, body: unknown) =>
  createOrder(request(PATH, { method: "POST", token: user?.accessToken, body }));

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
  await fillCart(alice, [{ productId: americano.id, quantity: 2 }]);
  await fillCart(bob, []);
});
afterEach(() => externalServices.resetHandlers());
afterAll(async () => {
  externalServices.close();
  await cleanup();
});

describe("POST /api/v1/orders", () => {
  it("returns 401 without a session", async () => {
    await expectProblem(await post(null, { paymentMethod: "cash", delivery }), 401, PATH);
  });

  it("creates a cash order priced from the database, empties the cart and persists it", async () => {
    const res = await post(alice, { paymentMethod: "cash", delivery });

    expect(res.status).toBe(201);
    const body = (await res.json()) as OrderBody;
    expect(res.headers.get("location")).toBe(`${PATH}/${body.order.id}`);
    expect(body.payment).toBeNull();
    expect(body.next).toBe(`/orders/${body.order.id}`);
    expect(body.order).toMatchObject({
      status: "cash_on_delivery",
      paymentMethod: "cash",
      subtotalMinor: 700000,
      totalMinor: 700000,
      currency: "NGN",
      customerEmail: alice.email,
      delivery,
      items: [{ productName: "Americano", unitPriceMinor: 350000, quantity: 2, lineTotalMinor: 700000 }],
    });

    expect(await cartRows(alice)).toEqual([]);
    expect(await orderRow(body.order.id)).toMatchObject({ user_id: alice.id, status: "cash_on_delivery", total_minor: 700000 });
    expect(paystack.initializeCalls).toEqual([]);
  });

  it("creates a card order, starts a Paystack transaction and keeps the cart until payment", async () => {
    const res = await post(alice, { paymentMethod: "card", delivery });

    expect(res.status).toBe(201);
    const body = (await res.json()) as OrderBody;
    expect(body.order.status).toBe("pending_payment");
    expect(body.payment).toEqual({
      provider: "paystack",
      reference: expect.stringMatching(/^cs_/),
      authorizationUrl: expect.stringMatching(/^https:\/\/checkout\.paystack\.com\//),
    });
    expect(body.next).toBe(body.payment!.authorizationUrl);

    expect(paystack.initializeCalls).toEqual([
      expect.objectContaining({
        email: alice.email,
        amount: 700000,
        currency: "NGN",
        reference: body.payment!.reference,
        callback_url: `${process.env.NEXT_PUBLIC_SITE_URL}/checkout/processing`,
        metadata: { order_id: body.order.id },
      }),
    ]);
    expect((await orderRow(body.order.id)).paystack_reference).toBe(body.payment!.reference);
    expect(await cartRows(alice)).toEqual([{ product_id: americano.id, quantity: 2 }]);
  });

  it("returns 502 and marks the order failed when Paystack is down, keeping the cart", async () => {
    paystack.initializeFails = true;

    const res = await post(alice, { paymentMethod: "card", delivery });

    await expectProblem(res, 502, PATH);
    const { data } = await admin().from("orders").select("status").eq("user_id", alice.id);
    expect(data).toEqual([{ status: "failed" }]);
    expect(await cartRows(alice)).toHaveLength(1);
  });

  it("returns 409 when the cart is empty", async () => {
    const body = await expectProblem(await post(bob, { paymentMethod: "cash", delivery }), 409, PATH);
    expect(body.detail).toMatch(/empty/i);
  });

  it("returns 409 when every item in the cart has been deactivated", async () => {
    const gone = await createTestProduct();
    await fillCart(bob, [{ productId: gone.id, quantity: 1 }]);
    await admin().from("products").update({ is_active: false }).eq("id", gone.id);

    await expectProblem(await post(bob, { paymentMethod: "cash", delivery }), 409, PATH);
  });

  it("leaves deactivated products out of the order total", async () => {
    const gone = await createTestProduct();
    await fillCart(alice, [
      { productId: cappuccino.id, quantity: 1 },
      { productId: gone.id, quantity: 5 },
    ]);
    await admin().from("products").update({ is_active: false }).eq("id", gone.id);

    const body = (await (await post(alice, { paymentMethod: "cash", delivery })).json()) as OrderBody;

    expect(body.order.totalMinor).toBe(420000);
    expect(body.order.items.map((i) => i.productName)).toEqual(["Cappuccino"]);
  });

  it.each([
    ["missing paymentMethod", { delivery }, "paymentMethod"],
    ["unknown paymentMethod", { paymentMethod: "bitcoin", delivery }, "paymentMethod"],
    ["missing delivery", { paymentMethod: "cash" }, "delivery"],
    ["blank name", { paymentMethod: "cash", delivery: { ...delivery, name: "   " } }, "delivery.name"],
    ["bad phone", { paymentMethod: "cash", delivery: { ...delivery, phone: "call me" } }, "delivery.phone"],
    ["short address", { paymentMethod: "cash", delivery: { ...delivery, address: "Lag" } }, "delivery.address"],
    ["long address", { paymentMethod: "cash", delivery: { ...delivery, address: "x".repeat(501) } }, "delivery.address"],
    ["client-supplied total (price tampering)", { paymentMethod: "cash", delivery, totalMinor: 1 }, "(root)"],
  ])("returns 422 for %s and creates nothing", async (_, body, field) => {
    const problem = await expectProblem(await post(alice, body), 422, PATH);

    expect(problem.errors?.map((e) => e.field)).toContain(field);
    const { data } = await admin().from("orders").select("id").eq("user_id", alice.id);
    expect(data).toEqual([]);
  });

  it("returns 400 for a malformed JSON body", async () => {
    const res = await createOrder(request(PATH, { method: "POST", token: alice.accessToken, rawBody: "{" }));
    await expectProblem(res, 400, PATH);
  });
});

describe("GET /api/v1/orders/{id}", () => {
  let orderId: string;
  beforeEach(async () => {
    orderId = ((await (await post(alice, { paymentMethod: "cash", delivery })).json()) as OrderBody).order.id;
  });
  const get = (user: TestUser | null, id: string) =>
    getOrder(request(`${PATH}/${id}`, { token: user?.accessToken }), params({ id }));

  it("returns the caller's order with its items", async () => {
    const res = await get(alice, orderId);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({ id: orderId, status: "cash_on_delivery", items: [{ productName: "Americano" }] });
  });

  it("returns 404 for someone else's order", async () => {
    await expectProblem(await get(bob, orderId), 404, `${PATH}/${orderId}`);
  });

  it("returns 404 for an unknown id", async () => {
    const id = unknownId();
    await expectProblem(await get(alice, id), 404, `${PATH}/${id}`);
  });

  it("returns 400 for a malformed id", async () => {
    await expectProblem(await get(alice, "latest"), 400, `${PATH}/latest`);
  });

  it("returns 401 without a session", async () => {
    await expectProblem(await get(null, orderId), 401, `${PATH}/${orderId}`);
  });
});

describe("GET /api/v1/orders", () => {
  const list = (user: TestUser | null, qs = "") => listOrders(request(`${PATH}${qs}`, { token: user?.accessToken }));

  it("returns an empty page for a user with no orders", async () => {
    const res = await list(bob);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [], nextCursor: null });
  });

  it("lists only the caller's orders, newest first, with cursor pagination", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      await fillCart(alice, [{ productId: americano.id, quantity: i + 1 }]);
      ids.push(((await (await post(alice, { paymentMethod: "cash", delivery })).json()) as OrderBody).order.id);
    }
    await fillCart(bob, [{ productId: americano.id, quantity: 1 }]);
    await post(bob, { paymentMethod: "cash", delivery });

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const body = (await (await list(alice, `?limit=1${cursor ? `&cursor=${cursor}` : ""}`)).json()) as {
        data: { id: string }[];
        nextCursor: string | null;
      };
      expect(body.data.length).toBeLessThanOrEqual(1);
      seen.push(...body.data.map((o) => o.id));
      cursor = body.nextCursor;
    } while (cursor);

    expect(seen).toEqual([...ids].reverse());
  });

  it.each(["?limit=0", "?limit=101", "?cursor=bogus"])("returns 400 for %s", async (qs) => {
    await expectProblem(await list(alice, qs), 400, PATH);
  });

  it("returns 401 without a session", async () => {
    await expectProblem(await list(null), 401, PATH);
  });
});
