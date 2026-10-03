import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DELETE as removeItem, PUT as setItem } from "@/app/api/v1/cart/items/[productId]/route";
import { GET as getCart } from "@/app/api/v1/cart/route";
import { GET as getOrder } from "@/app/api/v1/orders/[id]/route";
import { GET as listOrders, POST as createOrder } from "@/app/api/v1/orders/route";
import { GET as listProducts } from "@/app/api/v1/products/route";
import { ApiError, createApi } from "../mobile/src/lib/api";
import { formatNaira } from "../mobile/src/lib/money";
import { admin, cleanup, createTestUser, seededProduct, type TestUser } from "./helpers/db";
import { externalServices, listenOptions, mailgun } from "./helpers/paystack";

// The mobile app's API client (mobile/src/lib/api.ts) — pure TypeScript, so it
// runs here. The contract tests wire it to the website's real route handlers
// and database: proof the app speaks exactly the same /api/v1 as the website.

describe("formatNaira (mobile)", () => {
  it.each([
    [350000, "₦3,500.00"],
    [0, "₦0.00"],
    [5, "₦0.05"],
    [123456789, "₦1,234,567.89"],
    [-1050, "-₦10.50"],
  ])("%i -> %s", (kobo, text) => {
    expect(formatNaira(kobo)).toBe(text);
  });
});

describe("createApi (unit)", () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("sends the access token and JSON body, and parses the response", async () => {
    const fetchImpl = vi.fn(async () => json(200, { items: [], itemCount: 0, subtotalMinor: 0, currency: "NGN" }));
    const api = createApi({ baseUrl: "https://shop.test", getToken: async () => "tok", fetchImpl });

    await api.setQuantity("p-1", 2);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://shop.test/api/v1/cart/items/p-1");
    expect(init.method).toBe("PUT");
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok", "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ quantity: 2 });
  });

  it("sends no Authorization header when signed out", async () => {
    const fetchImpl = vi.fn(async () => json(200, { data: [], nextCursor: null }));
    await createApi({ baseUrl: "", getToken: async () => null, fetchImpl }).products();

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it('asks Paystack to return app payers to the "return to the app" page', async () => {
    const fetchImpl = vi.fn(async () => json(201, { order: {}, payment: null, next: "/" }));
    await createApi({ baseUrl: "", getToken: async () => "t", fetchImpl }).createOrder("card", {
      name: "Ada",
      phone: "08012345678",
      address: "1 Marina",
    });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ paymentMethod: "card", returnTo: "app" });
  });

  it("turns problem responses into ApiError with status, message and field errors", async () => {
    const fetchImpl = vi.fn(async () =>
      json(422, { title: "Request validation failed", detail: "1 field is invalid", errors: [{ field: "delivery.phone", message: "is bad" }] }),
    );
    const api = createApi({ baseUrl: "", getToken: async () => "t", fetchImpl });

    const err = await api.createOrder("cash", { name: "A", phone: "x", address: "12345" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, message: "1 field is invalid", fieldErrors: [{ field: "delivery.phone", message: "is bad" }] });
  });

  it("uses the title when there is no detail, and a generic message for non-JSON errors", async () => {
    const titleOnly = createApi({ baseUrl: "", getToken: async () => null, fetchImpl: async () => json(401, { title: "Authentication required" }) });
    await expect(titleOnly.cart()).rejects.toMatchObject({ status: 401, message: "Authentication required" });

    const html = createApi({ baseUrl: "", getToken: async () => null, fetchImpl: async () => new Response("<h1>oops</h1>", { status: 502 }) });
    await expect(html.cart()).rejects.toMatchObject({ status: 502, message: "Request failed (502)" });
  });

  it("reports a network failure as status 0 with a friendly message", async () => {
    const api = createApi({
      baseUrl: "",
      getToken: async () => null,
      fetchImpl: async () => {
        throw new TypeError("Network request failed");
      },
    });
    await expect(api.products()).rejects.toMatchObject({ status: 0, message: expect.stringContaining("internet") });
  });

  it("returns undefined for 204 No Content", async () => {
    const api = createApi({ baseUrl: "", getToken: async () => "t", fetchImpl: async () => new Response(null, { status: 204 }) });
    await expect(api.removeItem("p")).resolves.toBeUndefined();
  });

  it("encodes path and query values", async () => {
    const fetchImpl = vi.fn(async () => json(200, {}));
    const api = createApi({ baseUrl: "", getToken: async () => "t", fetchImpl });
    await api.verifyPayment("cs_a/b?c");
    await api.orders("cur sor");

    expect(fetchImpl.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([
      "/api/v1/payments/paystack/verify?reference=cs_a%2Fb%3Fc",
      "/api/v1/orders?limit=20&cursor=cur%20sor",
    ]);
  });
});

describe("mobile client ↔ website API (contract, real database)", () => {
  let user: TestUser;
  const ORIGIN = "http://localhost:3000";

  // Route the mobile client's requests to the website's real handlers in-process.
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(new URL(String(input), ORIGIN), init);
    const path = new URL(req.url).pathname;
    let m: RegExpMatchArray | null;
    if (path === "/api/v1/products") return listProducts(req);
    if (path === "/api/v1/cart") return getCart(req);
    if ((m = path.match(/^\/api\/v1\/cart\/items\/([^/]+)$/))) {
      const ctx = { params: Promise.resolve({ productId: decodeURIComponent(m[1]!) }) };
      return req.method === "DELETE" ? removeItem(req, ctx) : setItem(req, ctx);
    }
    if (path === "/api/v1/orders") return req.method === "POST" ? createOrder(req) : listOrders(req);
    if ((m = path.match(/^\/api\/v1\/orders\/([^/]+)$/))) return getOrder(req, { params: Promise.resolve({ id: m[1]! }) });
    throw new Error(`unrouted ${req.method} ${path}`);
  }) as typeof fetch;

  const mobileApi = () => createApi({ baseUrl: "", getToken: async () => user.accessToken, fetchImpl });

  beforeAll(async () => {
    externalServices.listen(listenOptions); // Mailgun stand-in for the cash order's email
    user = await createTestUser();
  });
  afterAll(async () => {
    externalServices.close();
    await cleanup();
  });

  it("browses, fills the cart, checks out with cash and reads the order back", async () => {
    mailgun.reset();
    const api = mobileApi();
    const americano = await seededProduct("americano");

    const products = await api.products();
    expect(products.data.map((p) => p.slug)).toEqual(expect.arrayContaining(["americano", "cappuccino", "yule-log-cake"]));

    const cart = await api.setQuantity(americano.id, 2);
    expect(cart).toMatchObject({ itemCount: 2, subtotalMinor: 700000, items: [expect.objectContaining({ slug: "americano" })] });
    expect((await api.cart()).itemCount).toBe(2);

    const created = await api.createOrder("cash", { name: "Ada Lovelace", phone: "08012345678", address: "12 Marina Road" });
    expect(created.order).toMatchObject({ status: "cash_on_delivery", totalMinor: 700000 });
    expect((await api.cart()).items).toEqual([]);

    const orders = await api.orders();
    expect(orders.data.map((o) => o.id)).toContain(created.order.id);
    expect((await api.order(created.order.id)).delivery.name).toBe("Ada Lovelace");
    expect(mailgun.to(user.email)).toHaveLength(1);
  });

  it("removes items and surfaces API errors as ApiError", async () => {
    const api = mobileApi();
    const cappuccino = await seededProduct("cappuccino");
    await api.setQuantity(cappuccino.id, 1);

    await expect(api.removeItem(cappuccino.id)).resolves.toBeUndefined();
    const { data } = await admin().from("cart_items").select("product_id").eq("user_id", user.id);
    expect(data).toEqual([]);

    await expect(api.createOrder("cash", { name: "Ada", phone: "nope", address: "12 Marina" })).rejects.toMatchObject({
      status: 422,
      fieldErrors: expect.arrayContaining([expect.objectContaining({ field: "delivery.phone" })]),
    });
    await expect(api.order("00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ status: 404 });
  });

  it("is rejected without a token, like the website", async () => {
    const api = createApi({ baseUrl: "", getToken: async () => null, fetchImpl });
    await expect(api.cart()).rejects.toMatchObject({ status: 401 });
  });
});
