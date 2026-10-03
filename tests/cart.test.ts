import { createServerClient } from "@supabase/ssr";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DELETE as removeItem, PUT as setItem } from "@/app/api/v1/cart/items/[productId]/route";
import { POST as mergeCart } from "@/app/api/v1/cart/merge/route";
import { GET as getCart } from "@/app/api/v1/cart/route";
import type { Tables } from "@/lib/database.types";
import { admin, cleanup, createTestProduct, createTestUser, seededProduct, type TestUser, unknownId } from "./helpers/db";
import { expectProblem, params, request } from "./helpers/http";

// The cart is always the caller's own (no cart id in the URL), so "forbidden"
// is covered as isolation: another user's requests never see or change it.
// 409 doesn't apply — PUT sets an absolute quantity and DELETE is idempotent.

type Cart = {
  items: { productId: string; slug: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }[];
  itemCount: number;
  subtotalMinor: number;
  currency: string;
  skipped?: string[];
};

let alice: TestUser;
let bob: TestUser;
let americano: Tables<"products">;
let cappuccino: Tables<"products">;

const itemPath = (id: string) => `/api/v1/cart/items/${id}`;
const put = (user: TestUser | null, productId: string, body: unknown) =>
  setItem(request(itemPath(productId), { method: "PUT", token: user?.accessToken, body }), params({ productId }));
const del = (user: TestUser | null, productId: string) =>
  removeItem(request(itemPath(productId), { method: "DELETE", token: user?.accessToken }), params({ productId }));
const cartOf = async (user: TestUser) => (await (await getCart(request("/api/v1/cart", { token: user.accessToken }))).json()) as Cart;
const merge = (user: TestUser | null, body: unknown) =>
  mergeCart(request("/api/v1/cart/merge", { method: "POST", token: user?.accessToken, body }));

async function dbRows(user: TestUser) {
  const { data, error } = await admin().from("cart_items").select("product_id, quantity").eq("user_id", user.id);
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  [alice, bob, americano, cappuccino] = await Promise.all([
    createTestUser(),
    createTestUser(),
    seededProduct("americano"),
    seededProduct("cappuccino"),
  ]);
});

beforeEach(async () => {
  await admin().from("cart_items").delete().in("user_id", [alice.id, bob.id]);
});

afterAll(cleanup);

describe("authentication", () => {
  const id = unknownId();
  it.each([
    ["GET /api/v1/cart", () => getCart(request("/api/v1/cart")), "/api/v1/cart"],
    ["PUT item", () => put(null, id, { quantity: 1 }), itemPath(id)],
    ["DELETE item", () => del(null, id), itemPath(id)],
    ["POST merge", () => merge(null, { items: [] }), "/api/v1/cart/merge"],
  ])("%s returns 401 without credentials", async (_, call, path) => {
    const res = await call();
    await expectProblem(res, 401, path);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("returns 401 for an invalid bearer token", async () => {
    await expectProblem(await getCart(request("/api/v1/cart", { token: "not-a-jwt" })), 401, "/api/v1/cart");
  });

  it("accepts the Supabase session cookie the browser sends", async () => {
    // Let @supabase/ssr write the cookie exactly as it does in the browser.
    const jar: { name: string; value: string }[] = [];
    const ssr = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll: () => jar,
        setAll: (c) => {
          jar.push(...c.map(({ name, value }) => ({ name, value })));
        },
      },
    });
    await ssr.auth.setSession({ access_token: alice.accessToken, refresh_token: alice.refreshToken });
    const cookie = jar.map((c) => `${c.name}=${c.value}`).join("; ");
    expect(cookie).toMatch(/sb-.+-auth-token/);

    const res = await getCart(request("/api/v1/cart", { headers: { cookie } }));

    expect(res.status).toBe(200);
  });

  it("returns 401 for a cookie that holds no valid session", async () => {
    const res = await getCart(request("/api/v1/cart", { headers: { cookie: "sb-x-auth-token=garbage" } }));
    await expectProblem(res, 401, "/api/v1/cart");
  });
});

describe("GET /api/v1/cart", () => {
  it("returns an empty cart for a new user", async () => {
    const res = await getCart(request("/api/v1/cart", { token: alice.accessToken }));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    // version 0: this user's cart has never changed (cart_versions has no row yet).
    expect(await res.json()).toEqual({ items: [], itemCount: 0, subtotalMinor: 0, currency: "NGN", version: 0 });
  });

  it("hides items whose product has been deactivated", async () => {
    const product = await createTestProduct();
    await put(alice, product.id, { quantity: 1 });
    await admin().from("products").update({ is_active: false }).eq("id", product.id);

    expect((await cartOf(alice)).items.map((i) => i.productId)).not.toContain(product.id);
  });
});

describe("PUT /api/v1/cart/items/{productId}", () => {
  it("adds the item, returns the cart with server-side prices, and persists it", async () => {
    const res = await put(alice, americano.id, { quantity: 2 });

    expect(res.status).toBe(200);
    const cart = (await res.json()) as Cart;
    expect(cart.items).toEqual([
      expect.objectContaining({ productId: americano.id, slug: "americano", quantity: 2, unitPriceMinor: 350000, lineTotalMinor: 700000 }),
    ]);
    expect(cart).toMatchObject({ itemCount: 2, subtotalMinor: 700000, currency: "NGN" });
    expect(await dbRows(alice)).toEqual([{ product_id: americano.id, quantity: 2 }]);
  });

  it("is idempotent and sets (not adds) the quantity", async () => {
    await put(alice, americano.id, { quantity: 3 });
    await put(alice, americano.id, { quantity: 3 });
    expect(await dbRows(alice)).toEqual([{ product_id: americano.id, quantity: 3 }]);

    await put(alice, americano.id, { quantity: 1 });
    expect(await dbRows(alice)).toEqual([{ product_id: americano.id, quantity: 1 }]);
  });

  it("accepts the quantity bounds 1 and 99", async () => {
    expect((await put(alice, americano.id, { quantity: 1 })).status).toBe(200);
    expect((await put(alice, americano.id, { quantity: 99 })).status).toBe(200);
  });

  it.each([
    ["quantity 0", { quantity: 0 }],
    ["quantity 100", { quantity: 100 }],
    ["fractional quantity", { quantity: 1.5 }],
    ["string quantity", { quantity: "2" }],
    ["missing quantity", {}],
    ["unknown field", { quantity: 1, price: 1 }],
  ])("returns 422 for %s", async (_, body) => {
    const problem = await expectProblem(await put(alice, americano.id, body), 422, itemPath(americano.id));

    expect(problem.errors?.length).toBeGreaterThan(0);
    expect(await dbRows(alice)).toEqual([]);
  });

  it("returns 400 for a malformed JSON body", async () => {
    const res = await setItem(
      request(itemPath(americano.id), { method: "PUT", token: alice.accessToken, rawBody: "{quantity:" }),
      params({ productId: americano.id }),
    );
    await expectProblem(res, 400, itemPath(americano.id));
  });

  it("returns 400 when productId is not a UUID", async () => {
    const problem = await expectProblem(await put(alice, "americano", { quantity: 1 }), 400, itemPath("americano"));
    expect(problem.errors?.[0]?.field).toBe("productId");
  });

  it("returns 404 for a product that doesn't exist", async () => {
    const id = unknownId();
    await expectProblem(await put(alice, id, { quantity: 1 }), 404, itemPath(id));
  });

  it("returns 404 for an inactive product", async () => {
    const product = await createTestProduct({ is_active: false });
    await expectProblem(await put(alice, product.id, { quantity: 1 }), 404, itemPath(product.id));
    expect(await dbRows(alice)).toEqual([]);
  });
});

describe("DELETE /api/v1/cart/items/{productId}", () => {
  it("removes the item and returns 204 with no body", async () => {
    await put(alice, americano.id, { quantity: 1 });
    await put(alice, cappuccino.id, { quantity: 1 });

    const res = await del(alice, americano.id);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(await dbRows(alice)).toEqual([{ product_id: cappuccino.id, quantity: 1 }]);
  });

  it("is idempotent — deleting a missing item is still 204", async () => {
    expect((await del(alice, americano.id)).status).toBe(204);
    expect((await del(alice, americano.id)).status).toBe(204);
  });

  it("returns 400 when productId is not a UUID", async () => {
    await expectProblem(await del(alice, "nope"), 400, itemPath("nope"));
  });
});

describe("isolation between users", () => {
  it("one user's cart is invisible to and unchangeable by another", async () => {
    await put(alice, americano.id, { quantity: 4 });

    expect((await cartOf(bob)).items).toEqual([]);
    expect((await del(bob, americano.id)).status).toBe(204); // only affects Bob's own cart
    await put(bob, americano.id, { quantity: 1 });

    expect(await dbRows(alice)).toEqual([{ product_id: americano.id, quantity: 4 }]);
    expect(await dbRows(bob)).toEqual([{ product_id: americano.id, quantity: 1 }]);
  });
});

describe("POST /api/v1/cart/merge", () => {
  it("merges a guest cart, keeping the larger quantity per product", async () => {
    await put(alice, americano.id, { quantity: 5 });

    const res = await merge(alice, {
      items: [
        { productId: americano.id, quantity: 2 },
        { productId: cappuccino.id, quantity: 3 },
      ],
    });

    expect(res.status).toBe(200);
    const cart = (await res.json()) as Cart;
    expect(cart.skipped).toEqual([]);
    expect(cart.itemCount).toBe(8);
    const rows = await dbRows(alice);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { product_id: americano.id, quantity: 5 },
        { product_id: cappuccino.id, quantity: 3 },
      ]),
    );
  });

  it("is safe to retry — the same merge twice doesn't inflate quantities", async () => {
    const body = { items: [{ productId: cappuccino.id, quantity: 2 }] };
    await merge(alice, body);
    await merge(alice, body);

    expect(await dbRows(alice)).toEqual([{ product_id: cappuccino.id, quantity: 2 }]);
  });

  it("collapses duplicate products in the request", async () => {
    await merge(alice, {
      items: [
        { productId: americano.id, quantity: 1 },
        { productId: americano.id, quantity: 4 },
      ],
    });

    expect(await dbRows(alice)).toEqual([{ product_id: americano.id, quantity: 4 }]);
  });

  it("skips unknown and inactive products and reports them", async () => {
    const inactive = await createTestProduct({ is_active: false });
    const missing = unknownId();

    const res = await merge(alice, {
      items: [
        { productId: americano.id, quantity: 1 },
        { productId: inactive.id, quantity: 1 },
        { productId: missing, quantity: 1 },
      ],
    });

    const cart = (await res.json()) as Cart;
    expect(cart.skipped?.sort()).toEqual([inactive.id, missing].sort());
    expect(await dbRows(alice)).toEqual([{ product_id: americano.id, quantity: 1 }]);
  });

  it("accepts an empty guest cart and leaves the cart unchanged", async () => {
    await put(alice, americano.id, { quantity: 1 });
    const res = await merge(alice, { items: [] });

    expect(res.status).toBe(200);
    expect(await dbRows(alice)).toEqual([{ product_id: americano.id, quantity: 1 }]);
  });

  it.each([
    ["missing items", {}],
    ["items not an array", { items: "x" }],
    ["bad productId", { items: [{ productId: "x", quantity: 1 }] }],
    ["quantity over 99", { items: [{ productId: unknownId(), quantity: 100 }] }],
    ["more than 50 items", { items: Array.from({ length: 51 }, () => ({ productId: unknownId(), quantity: 1 })) }],
  ])("returns 422 for %s", async (_, body) => {
    await expectProblem(await merge(alice, body), 422, "/api/v1/cart/merge");
    expect(await dbRows(alice)).toEqual([]);
  });

  it("returns 400 for a malformed JSON body", async () => {
    const res = await mergeCart(request("/api/v1/cart/merge", { method: "POST", token: alice.accessToken, rawBody: "[" }));
    await expectProblem(res, 400, "/api/v1/cart/merge");
  });
});
