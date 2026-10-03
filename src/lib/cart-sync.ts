import type { SupabaseClient } from "@supabase/supabase-js";

// Live cart sync (web + mobile). Every change to a user's cart_items bumps
// their row in public.cart_versions (migration 20261003090000), which Supabase
// Realtime pushes only to that user (RLS). Clients then re-read
// GET /api/v1/cart, so the API stays the single source of truth.
//
// mobile/src/lib/cart-sync.ts is a copy of this file (the Expo app can't import
// from the web app's src/); keep the two in sync.

export type CartSyncStatus = "connecting" | "live" | "offline";

type Options = {
  /** Collapse bursts (a merge touches several rows) into one refresh. */
  debounceMs?: number;
  onStatus?: (status: CartSyncStatus) => void;
};

/**
 * Subscribe to "this user's cart changed". `onChange` runs once per burst of
 * changes, and also right after (re)connecting, to catch anything missed while
 * offline. Returns an unsubscribe function.
 */
export function subscribeToCartChanges(
  client: SupabaseClient,
  userId: string,
  onChange: () => void,
  { debounceMs = 150, onStatus }: Options = {},
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const schedule = () => {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!closed) onChange();
    }, debounceMs);
  };

  onStatus?.("connecting");
  const channel = client
    .channel(`cart-sync:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "cart_versions", filter: `user_id=eq.${userId}` },
      schedule,
    )
    .subscribe((status) => {
      if (closed) return;
      if (status === "SUBSCRIBED") {
        onStatus?.("live");
        schedule(); // catch up on anything that changed while we weren't listening
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
