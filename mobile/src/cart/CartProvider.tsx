import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { ApiError, type Cart, type Product } from "@/lib/api";
import { resolveSnapshot, subscribeToCartChanges, type CartSnapshot, type CartSyncStatus } from "@/lib/cart-sync";
import { api } from "@/lib/shop-api";
import { supabase } from "@/lib/supabase";

const MAX_QUANTITY = 99;
const EMPTY: Cart = { items: [], itemCount: 0, subtotalMinor: 0, currency: "NGN", version: 0 };

/** Build the screen's cart from a pushed snapshot plus known products (null if a product is unknown). */
function cartFromSnapshot(snapshot: CartSnapshot, catalog: ReadonlyMap<string, Product>): Cart | null {
  const lines = resolveSnapshot(snapshot, catalog);
  if (!lines) return null;
  const items = lines.map(({ product: p, quantity }) => ({
    productId: p.id,
    slug: p.slug,
    name: p.name,
    imageUrl: p.imageUrl,
    unitPriceMinor: p.priceMinor,
    quantity,
    lineTotalMinor: p.priceMinor * quantity,
  }));
  return {
    items,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    subtotalMinor: items.reduce((n, i) => n + i.lineTotalMinor, 0),
    currency: "NGN",
    version: snapshot.version,
  };
}

type CartApi = {
  cart: Cart;
  /** false while the first load after sign-in is in flight */
  ready: boolean;
  /** Realtime link to the shared cart ("live" = changes on the website appear instantly). */
  sync: CartSyncStatus | "signed-out";
  error: string | null;
  add(product: Product): Promise<void>;
  setQuantity(productId: string, quantity: number): Promise<void>;
  remove(productId: string): Promise<void>;
  refresh(): Promise<void>;
};

const CartContext = createContext<CartApi | null>(null);

/**
 * The signed-in user's cart, the same one the website shows. Reads and writes
 * go through /api/v1/cart; Supabase Realtime pushes the new cart when it changes
 * elsewhere, and we show it straight away.
 */
export function CartProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [cart, setCart] = useState<Cart>(EMPTY);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<CartSyncStatus | "signed-out">("signed-out");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0); // ignore responses that arrive after a newer request
  const shownVersion = useRef(-1); // cart_versions.version on screen; never go backwards
  const catalog = useRef<Map<string, Product>>(new Map());

  /** Show a cart from the API, unless something newer is already on screen. */
  const accept = useCallback((next: Cart) => {
    if (next.version < shownVersion.current) return;
    shownVersion.current = next.version;
    setCart(next);
  }, []);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await api.cart();
      if (ticket === latest.current) {
        accept(next);
        setError(null);
      }
    } catch (err) {
      if (ticket === latest.current) setError(err instanceof ApiError ? err.message : "Couldn't load your cart.");
    } finally {
      if (ticket === latest.current) setReady(true);
    }
  }, [accept]);

  /** A pushed cart: show it at once if it is newer and all its products are known. */
  const applySnapshot = useCallback(
    (snapshot: CartSnapshot) => {
      if (snapshot.version <= shownVersion.current) return;
      const next = cartFromSnapshot(snapshot, catalog.current);
      if (!next) return void load(); // a product we don't know yet: ask the API
      latest.current++; // any slower API read in flight is now out of date
      shownVersion.current = next.version;
      setCart(next);
      setReady(true);
    },
    [load],
  );

  // Sign-in / sign-out: load the cart and connect the live signal.
  useEffect(() => {
    if (!userId || !session) {
      shownVersion.current = -1;
      setCart(EMPTY);
      setReady(false);
      setSync("signed-out");
      return;
    }
    void load();
    // Product details for showing pushed carts without asking the API.
    void api
      .products()
      .then((page) => {
        catalog.current = new Map(page.data.map((p) => [p.id, p]));
      })
      .catch(() => {}); // without it, pushes just fall back to re-reading the cart
    void supabase.realtime.setAuth(session.access_token);
    const unsubscribe = subscribeToCartChanges(
      supabase,
      userId,
      { onSnapshot: applySnapshot, onResync: () => void load() },
      { onStatus: setSync },
    );
    // Back from the background: re-read in case the socket was asleep.
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
    // Depends on the user, not the token: supabase-js re-authenticates the socket on token refresh.
  }, [userId, load, applySnapshot]);

  const apply = useCallback(
    async (change: () => Promise<Cart | void>, optimistic: (c: Cart) => Cart) => {
      latest.current++; // a refresh already in flight is now stale
      setCart((c) => optimistic(c));
      try {
        const next = await change();
        if (next) accept(next);
        else await load();
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "That didn't work. Please try again.");
        await load(); // put back the server's version
      }
    },
    [load, accept],
  );

  const value = useMemo<CartApi>(() => {
    const qtyOf = (id: string) => cart.items.find((i) => i.productId === id)?.quantity ?? 0;
    const recount = (items: Cart["items"]): Cart => ({
      ...cart,
      items,
      itemCount: items.reduce((n, i) => n + i.quantity, 0),
      subtotalMinor: items.reduce((n, i) => n + i.lineTotalMinor, 0),
    });
    const withQuantity = (c: Cart, id: string, q: number, product?: Product): Cart => {
      const exists = c.items.some((i) => i.productId === id);
      const items = exists
        ? c.items.map((i) => (i.productId === id ? { ...i, quantity: q, lineTotalMinor: i.unitPriceMinor * q } : i))
        : product
          ? [
              ...c.items,
              {
                productId: id,
                slug: product.slug,
                name: product.name,
                imageUrl: product.imageUrl,
                unitPriceMinor: product.priceMinor,
                quantity: q,
                lineTotalMinor: product.priceMinor * q,
              },
            ]
          : c.items;
      return recount(items);
    };

    return {
      cart,
      ready,
      sync,
      error,
      refresh: load,
      async add(product) {
        const q = Math.min(MAX_QUANTITY, qtyOf(product.id) + 1);
        await apply(() => api.setQuantity(product.id, q), (c) => withQuantity(c, product.id, q, product));
      },
      async setQuantity(productId, quantity) {
        const q = Math.max(1, Math.min(MAX_QUANTITY, Math.trunc(quantity)));
        await apply(() => api.setQuantity(productId, q), (c) => withQuantity(c, productId, q));
      },
      async remove(productId) {
        await apply(
          () => api.removeItem(productId),
          (c) => recount(c.items.filter((i) => i.productId !== productId)),
        );
      },
    };
  }, [cart, ready, sync, error, load, apply]);

  return <CartContext value={value}>{children}</CartContext>;
}

export function useCart(): CartApi {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
