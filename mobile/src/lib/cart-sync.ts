import type { SupabaseClient } from "@supabase/supabase-js";

// Live cart sync (web + mobile). Every change to a user's cart_items updates
// their row in public.cart_versions (version + a snapshot of the items), which
// Supabase Realtime pushes only to that user (RLS). Clients apply the snapshot
// straight away, with prices and names from the products they already have.
// Pushes without a usable snapshot, and every (re)connect, fall back to
// re-reading GET /api/v1/cart.
//
// Copy of the web app's src/lib/cart-sync.ts (the Expo app can't import
// from the web app's src/); keep the two in sync.

export type CartSyncStatus = "connecting" | "live" | "offline";

export type CartSnapshot = { version: number; items: { productId: string; quantity: number }[] };

type Handlers = {
  /** A pushed cart: apply it if its version is newer than what's shown. Called immediately. */
  onSnapshot(snapshot: CartSnapshot): void;
  /** Re-read the cart from the API (after (re)connecting, or a push without a usable snapshot). */
  onResync(): void;
};

type Options = {
  /** Collapse bursts of resyncs into one API call. */
  debounceMs?: number;
  onStatus?: (status: CartSyncStatus) => void;
};

/** Validate a cart_versions row from a Realtime payload. Returns null if it isn't a usable snapshot. */
export function parseSnapshot(row: unknown): CartSnapshot | null {
  if (!row || typeof row !== "object") return null;
  const { version, items } = row as { version?: unknown; items?: unknown };
  const v = typeof version === "string" ? Number(version) : version; // bigint may arrive as a string
  if (typeof v !== "number" || !Number.isFinite(v) || !Array.isArray(items)) return null;
  const parsed: CartSnapshot["items"] = [];
  for (const item of items) {
    const { productId, quantity } = (item ?? {}) as { productId?: unknown; quantity?: unknown };
    if (typeof productId !== "string" || typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
      return null;
    }
    parsed.push({ productId, quantity });
  }
  return { version: v, items: parsed };
}

/**
 * Pair a snapshot with full product details. Returns null when a product isn't
 * in `catalog` (inactive, or the catalog isn't loaded yet), so the caller can
 * re-read the cart from the API instead.
 */
export function resolveSnapshot<P>(
  snapshot: CartSnapshot,
  catalog: ReadonlyMap<string, P>,
): { product: P; quantity: number }[] | null {
  const lines: { product: P; quantity: number }[] = [];
  for (const { productId, quantity } of snapshot.items) {
    const product = catalog.get(productId);
    if (!product) return null;
    lines.push({ product, quantity });
  }
  return lines;
}

/**
 * Subscribe to "this user's cart changed". Returns an unsubscribe function.
 */
export function subscribeToCartChanges(
  client: SupabaseClient,
  userId: string,
  { onSnapshot, onResync }: Handlers,
  { debounceMs = 150, onStatus }: Options = {},
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const resync = () => {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!closed) onResync();
    }, debounceMs);
  };

  onStatus?.("connecting");
  const channel = client
    .channel(`cart-sync:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "cart_versions", filter: `user_id=eq.${userId}` },
      (payload: { new?: unknown }) => {
        if (closed) return;
        const snapshot = parseSnapshot(payload?.new);
        if (snapshot) onSnapshot(snapshot);
        else resync();
      },
    )
    .subscribe((status) => {
      if (closed) return;
      if (status === "SUBSCRIBED") {
        onStatus?.("live");
        resync(); // catch up on anything that changed while we weren't listening
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        onStatus?.("offline");
      }
    });

  return () => {
    closed = true;
    clearTimeout(timer);
    void client.removeChannel(channel);
  };
}
