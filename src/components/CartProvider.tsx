"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Cart } from "@/lib/cart";
import { MAX_QUANTITY } from "@/lib/cart";
import { resolveSnapshot, subscribeToCartChanges, type CartSnapshot } from "@/lib/cart-sync";
import { browserSupabase } from "@/lib/supabase/browser";
import { guestCart, useGuestCart, type GuestCartItem } from "@/lib/guest-cart";

type Item = GuestCartItem;
type Product = Omit<Item, "quantity">;

type CartApi = {
  items: Item[];
  count: number;
  subtotalMinor: number;
  /** false while a signed-in cart is loading from the server */
  ready: boolean;
  signedIn: boolean;
  add(product: Product, quantity?: number): Promise<void>;
  setQuantity(productId: string, quantity: number): Promise<void>;
  remove(productId: string): Promise<void>;
  /** Re-read the cart from the server (e.g. after an order empties it). */
  refresh(): Promise<void>;
};

const CartContext = createContext<CartApi | null>(null);
const JSON_HEADERS = { "Content-Type": "application/json" };

const fromServer = (cart: Cart): Item[] =>
  cart.items.map(({ productId, slug, name, imageUrl, unitPriceMinor, quantity }) => ({
    productId,
    slug,
    name,
    imageUrl,
    unitPriceMinor,
    quantity,
  }));

type ServerCart = { items: Item[]; version: number };

/** Fetch the server cart, first merging (then clearing) any guest cart. */
async function fetchServerCart(): Promise<ServerCart | null> {
  const pending = guestCart.current();
  const res = pending.length
    ? await fetch("/api/v1/cart/merge", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ items: pending.map(({ productId, quantity }) => ({ productId, quantity })) }),
      })
    : await fetch("/api/v1/cart");
  if (!res.ok) return null;
  if (pending.length) guestCart.clear();
  const cart = (await res.json()) as Cart;
  return { items: fromServer(cart), version: cart.version ?? 0 };
}

/** Active products by id, so a pushed cart snapshot can be shown without asking the API. */
async function fetchCatalog(): Promise<Map<string, Product>> {
  const res = await fetch("/api/v1/products?limit=100");
  if (!res.ok) return new Map();
  const { data } = (await res.json()) as {
    data: { id: string; slug: string; name: string; imageUrl: string; priceMinor: number }[];
  };
  return new Map(
    data.map((p) => [p.id, { productId: p.id, slug: p.slug, name: p.name, imageUrl: p.imageUrl, unitPriceMinor: p.priceMinor }]),
  );
}

/**
 * One cart API for the whole app. Guests use localStorage; signed-in users use
 * /api/v1/cart. On the first render after sign-in the guest cart is merged into
 * the server cart and then cleared.
 */
export function CartProvider({
  signedIn,
  userId,
  children,
}: {
  signedIn: boolean;
  userId: string | null;
  children: React.ReactNode;
}) {
  const guest = useGuestCart();
  const [serverItems, setServerItems] = useState<Item[] | null>(null);
  const shownVersion = useRef(-1); // cart_versions.version currently on screen
  const catalog = useRef<Map<string, Product>>(new Map());

  const accept = useCallback((cart: ServerCart) => {
    shownVersion.current = Math.max(shownVersion.current, cart.version);
    setServerItems(cart.items);
  }, []);

  const load = useCallback(async () => {
    const cart = await fetchServerCart();
    if (cart) accept(cart);
  }, [accept]);

  /** Show a pushed cart straight away (no API call) if it is newer and every product is known. */
  const applySnapshot = useCallback(
    (snapshot: CartSnapshot) => {
      if (snapshot.version <= shownVersion.current) return; // older than what we show
      const lines = resolveSnapshot(snapshot, catalog.current);
      if (!lines) return void load(); // a product we don't know yet: ask the API
      shownVersion.current = snapshot.version;
      setServerItems(lines.map(({ product, quantity }) => ({ ...product, quantity })));
    },
    [load],
  );

  // Live sync: when this user's cart changes anywhere (the mobile app, another
  // tab), Supabase Realtime pushes the new cart and we show it immediately.
  useEffect(() => {
    if (!signedIn || !userId) return;
    const supabase = browserSupabase();
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled || !data.session) return;
      void supabase.realtime.setAuth(data.session.access_token);
      unsubscribe = subscribeToCartChanges(supabase, userId, {
        onSnapshot: applySnapshot,
        onResync: () => void load(),
      });
    });
    void fetchCatalog().then((map) => {
      if (!cancelled) catalog.current = map;
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [signedIn, userId, load, applySnapshot]);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void fetchServerCart().then((cart) => {
      if (!cancelled && cart) accept(cart);
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, accept]);

  const sendQuantity = useCallback(
    async (productId: string, quantity: number) => {
      const res = await fetch(`/api/v1/cart/items/${productId}`, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ quantity }),
      });
      if (res.ok) {
        const cart = (await res.json()) as Cart;
        accept({ items: fromServer(cart), version: cart.version ?? 0 });
      }
      else await load(); // resync after a rejected change
    },
    [load, accept],
  );

  const api = useMemo<CartApi>(() => {
    if (!signedIn) {
      return {
        items: guest.items,
        count: guest.count,
        subtotalMinor: guest.subtotalMinor,
        ready: true,
        signedIn,
        add: async (p, q = 1) => guestCart.add(p, q),
        setQuantity: async (id, q) => guestCart.setQuantity(id, q),
        remove: async (id) => guestCart.remove(id),
        refresh: async () => {},
      };
    }

    const items = serverItems ?? [];
    return {
      items,
      count: items.reduce((n, i) => n + i.quantity, 0),
      subtotalMinor: items.reduce((n, i) => n + i.unitPriceMinor * i.quantity, 0),
      ready: serverItems !== null,
      signedIn,
      async add(p, q = 1) {
        const next = Math.min(MAX_QUANTITY, (items.find((i) => i.productId === p.productId)?.quantity ?? 0) + q);
        setServerItems((cur) => {
          const list = cur ?? [];
          return list.some((i) => i.productId === p.productId)
            ? list.map((i) => (i.productId === p.productId ? { ...i, quantity: next } : i))
            : [...list, { ...p, quantity: next }];
        });
        await sendQuantity(p.productId, next);
      },
      async setQuantity(id, q) {
        const next = Math.max(1, Math.min(MAX_QUANTITY, Math.trunc(q)));
        setServerItems((cur) => (cur ?? []).map((i) => (i.productId === id ? { ...i, quantity: next } : i)));
        await sendQuantity(id, next);
      },
      refresh: load,
      async remove(id) {
        setServerItems((cur) => (cur ?? []).filter((i) => i.productId !== id));
        const res = await fetch(`/api/v1/cart/items/${id}`, { method: "DELETE" });
        if (!res.ok) await load();
      },
    };
  }, [signedIn, guest.items, guest.count, guest.subtotalMinor, serverItems, sendQuantity, load]);

  return <CartContext value={api}>{children}</CartContext>;
}

export function useCart(): CartApi {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
