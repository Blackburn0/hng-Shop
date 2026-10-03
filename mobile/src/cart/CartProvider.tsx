import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { ApiError, type Cart, type Product } from "@/lib/api";
import { subscribeToCartChanges, type CartSyncStatus } from "@/lib/cart-sync";
import { api } from "@/lib/shop-api";
import { supabase } from "@/lib/supabase";

const MAX_QUANTITY = 99;
const EMPTY: Cart = { items: [], itemCount: 0, subtotalMinor: 0, currency: "NGN" };

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
 * go through /api/v1/cart; Supabase Realtime tells us when it changed elsewhere.
 */
export function CartProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [cart, setCart] = useState<Cart>(EMPTY);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<CartSyncStatus | "signed-out">("signed-out");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0); // ignore responses that arrive after a newer request

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await api.cart();
      if (ticket === latest.current) {
        setCart(next);
        setError(null);
      }
    } catch (err) {
      if (ticket === latest.current) setError(err instanceof ApiError ? err.message : "Couldn't load your cart.");
    } finally {
      if (ticket === latest.current) setReady(true);
    }
  }, []);

  // Sign-in / sign-out: load the cart and connect the live signal.
  useEffect(() => {
    if (!userId || !session) {
      setCart(EMPTY);
      setReady(false);
      setSync("signed-out");
      return;
    }
    void load();
    void supabase.realtime.setAuth(session.access_token);
    const unsubscribe = subscribeToCartChanges(supabase, userId, () => void load(), { onStatus: setSync });
    // Back from the background: re-read in case the socket was asleep.
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
    // Depends on the user, not the token: supabase-js re-authenticates the socket on token refresh.
  }, [userId, load]);

  const apply = useCallback(
    async (change: () => Promise<Cart | void>, optimistic: (c: Cart) => Cart) => {
      latest.current++; // a refresh already in flight is now stale
      setCart((c) => optimistic(c));
      try {
        const next = await change();
        if (next) setCart(next);
        else await load();
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "That didn't work. Please try again.");
        await load(); // put back the server's version
      }
    },
    [load],
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
