import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The guest cart runs in the browser. Node has no localStorage/window, so this
// file provides a minimal in-memory stand-in for those two browser APIs.
const KEY = "coffee-shop:cart:v1";
let store: Map<string, string>;
let throwOnSet = false;
const listeners = new Map<string, Set<(e: unknown) => void>>();

beforeEach(() => {
  store = new Map();
  throwOnSet = false;
  listeners.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (throwOnSet) throw new Error("QuotaExceededError");
      store.set(k, v);
    },
  });
  vi.stubGlobal("window", {
    addEventListener: (t: string, fn: (e: unknown) => void) => {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(fn);
    },
    removeEventListener: (t: string, fn: (e: unknown) => void) => listeners.get(t)?.delete(fn),
  });
  vi.resetModules(); // fresh module-level cache per test
});

const load = () => import("@/lib/guest-cart");
const saved = () => JSON.parse(store.get(KEY) ?? "null");

const americano = {
  productId: "09e2797e-d3ad-47ed-a392-0689c8b53e74",
  slug: "americano",
  name: "Americano",
  imageUrl: "/products/americano.jpg",
  unitPriceMinor: 350000,
};
const cake = { ...americano, productId: "ba5c6c07-03c5-4f29-b41c-c8b50ae115a1", slug: "yule-log-cake", unitPriceMinor: 550000 };

describe("guestCart", () => {
  it("adds items and increments quantity for repeat adds", async () => {
    const { guestCart } = await load();
    guestCart.add(americano);
    guestCart.add(americano, 2);
    guestCart.add(cake);

    expect(saved()).toEqual([
      { ...americano, quantity: 3 },
      { ...cake, quantity: 1 },
    ]);
  });

  it("clamps quantities to 1..99", async () => {
    const { guestCart } = await load();
    guestCart.add(americano, 500);
    expect(saved()[0].quantity).toBe(99);

    guestCart.setQuantity(americano.productId, 0);
    expect(saved()[0].quantity).toBe(1);

    guestCart.setQuantity(americano.productId, 7.9);
    expect(saved()[0].quantity).toBe(7);
  });

  it("removes and clears items", async () => {
    const { guestCart } = await load();
    guestCart.add(americano);
    guestCart.add(cake);

    guestCart.remove(americano.productId);
    expect(saved().map((i: { slug: string }) => i.slug)).toEqual(["yule-log-cake"]);

    guestCart.clear();
    expect(saved()).toEqual([]);
  });

  it("loads a saved cart and drops invalid entries", async () => {
    store.set(KEY, JSON.stringify([{ ...americano, quantity: 2 }, { productId: "nope", quantity: 1 }, "junk"]));
    const { guestCart } = await load();
    guestCart.add(cake);

    expect(saved()).toEqual([
      { ...americano, quantity: 2 },
      { ...cake, quantity: 1 },
    ]);
  });

  it.each([["not json {"], [JSON.stringify({ not: "an array" })]])("treats corrupt storage %s as empty", async (raw) => {
    store.set(KEY, raw);
    const { guestCart } = await load();
    guestCart.add(americano);

    expect(saved()).toEqual([{ ...americano, quantity: 1 }]);
  });

  it("keeps working in memory when storage writes fail", async () => {
    const { guestCart } = await load();
    throwOnSet = true;

    expect(() => guestCart.add(americano)).not.toThrow();
  });
});

describe("useGuestCart", () => {
  it("renders an empty cart on the server (no localStorage during SSR)", async () => {
    const { useGuestCart } = await load();
    let result: ReturnType<typeof useGuestCart> | undefined;
    function Probe() {
      result = useGuestCart();
      return null;
    }
    renderToString(createElement(Probe));

    expect(result).toMatchObject({ items: [], count: 0, subtotalMinor: 0 });
  });
});
