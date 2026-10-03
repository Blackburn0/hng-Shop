import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as removeItem, PUT as setItem } from "@/app/api/v1/cart/items/[productId]/route";
import { subscribeToCartChanges, type CartSyncStatus } from "@/lib/cart-sync";
import type { Database, Tables } from "@/lib/database.types";
import { admin, cleanup, createTestUser, seededProduct, type TestUser } from "./helpers/db";
import { params, request } from "./helpers/http";

// Live cart sync: cart_items change -> cart_versions bump (DB trigger) ->
// Supabase Realtime -> subscribeToCartChanges() -> client re-reads the cart.

describe("subscribeToCartChanges() (fake channel)", () => {
  type Handler = () => void;
  function fakeClient() {
    const state = { handler: undefined as Handler | undefined, status: undefined as ((s: string) => void) | undefined, removed: 0, filter: "" };
    const channel = {
      on: (_type: string, cfg: { filter: string }, handler: Handler) => {
        state.filter = cfg.filter;
        state.handler = handler;
        return channel;
      },
      subscribe: (cb: (s: string) => void) => {
        state.status = cb;
        return channel;
      },
    };
    const client = { channel: () => channel, removeChannel: () => void state.removed++ } as unknown as SupabaseClient;
    return { client, state };
  }

  beforeEach(() => vi.useFakeTimers());

  it("listens only to the user's own row", () => {
    const { client, state } = fakeClient();
    subscribeToCartChanges(client, "user-1", () => {});
    expect(state.filter).toBe("user_id=eq.user-1");
  });

  it("collapses a burst of changes into one refresh", () => {
    const { client, state } = fakeClient();
    const onChange = vi.fn();
    subscribeToCartChanges(client, "u", onChange, { debounceMs: 100 });

    state.handler!();
    state.handler!();
    state.handler!();
    vi.advanceTimersByTime(99);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("refreshes once it's (re)connected and reports its status", () => {
    const { client, state } = fakeClient();
    const onChange = vi.fn();
    const statuses: CartSyncStatus[] = [];
    subscribeToCartChanges(client, "u", onChange, { debounceMs: 10, onStatus: (s) => statuses.push(s) });

    state.status!("SUBSCRIBED");
    vi.advanceTimersByTime(10);
    state.status!("CHANNEL_ERROR");
    state.status!("SUBSCRIBED");
    vi.advanceTimersByTime(10);

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(["connecting", "live", "offline", "live"]);
  });

  it("works without a status callback, and refreshes on (re)connect", () => {
    const { client, state } = fakeClient();
    const onChange = vi.fn();
    subscribeToCartChanges(client, "u", onChange); // default debounce, no onStatus

    state.status!("SUBSCRIBED");
    state.status!("TIMED_OUT");
    vi.advanceTimersByTime(150);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("ignores status updates that arrive after unsubscribing", () => {
    const { client, state } = fakeClient();
    const statuses: CartSyncStatus[] = [];
    const unsubscribe = subscribeToCartChanges(client, "u", () => {}, { onStatus: (s) => statuses.push(s) });

    unsubscribe();
    state.status!("CLOSED");
    state.status!("SUBSCRIBED");

    expect(statuses).toEqual(["connecting"]);
  });

  it("stops after unsubscribing, including a pending refresh", () => {
    const { client, state } = fakeClient();
    const onChange = vi.fn();
    const unsubscribe = subscribeToCartChanges(client, "u", onChange, { debounceMs: 50 });

    state.handler!();
    unsubscribe();
    state.handler!();
    state.status!("SUBSCRIBED");
    vi.advanceTimersByTime(100);

    expect(onChange).not.toHaveBeenCalled();
    expect(state.removed).toBe(1);
  });
});

describe("live sync through Supabase Realtime (real database)", () => {
  let alice: TestUser;
  let bob: TestUser;
  let americano: Tables<"products">;
  const clients: SupabaseClient[] = [];
  const stops: (() => void)[] = [];

  async function realtimeClientFor(user: TestUser) {
    const c = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await c.auth.setSession({ access_token: user.accessToken, refresh_token: user.refreshToken });
    await c.realtime.setAuth(user.accessToken);
    clients.push(c as unknown as SupabaseClient);
    return c as unknown as SupabaseClient;
  }

  /** Subscribe and resolve once the channel is live; count change notifications. */
  async function listen(user: TestUser) {
    const client = await realtimeClientFor(user);
    const events = { count: 0 };
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("realtime subscribe timed out")), 15_000);
      let first = true;
      stops.push(
        subscribeToCartChanges(
          client,
          user.id,
          () => {
            // The first call is the catch-up refresh right after subscribing.
            if (first) {
              first = false;
              return;
            }
            events.count++;
          },
          {
            debounceMs: 50,
            onStatus: (s) => {
              if (s === "live") {
                clearTimeout(timeout);
                setTimeout(resolve, 300); // let the catch-up refresh fire first
              }
            },
          },
        ),
      );
    });
    return events;
  }

  const until = async (check: () => boolean, ms = 10_000) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > ms) return false;
      await new Promise((r) => setTimeout(r, 50));
    }
    return true;
  };

  beforeAll(async () => {
    vi.useRealTimers();
    [alice, bob, americano] = await Promise.all([createTestUser(), createTestUser(), seededProduct("americano")]);
  });
  afterAll(async () => {
    stops.forEach((stop) => stop());
    await Promise.all(clients.map((c) => c.removeAllChannels()));
    await cleanup();
  });
  beforeEach(() => vi.useRealTimers());

  it("a cart change via the API reaches the owner's subscription within seconds — and nobody else's", async () => {
    const aliceEvents = await listen(alice);
    const bobEvents = await listen(bob);

    const started = Date.now();
    const res = await setItem(
      request(`/api/v1/cart/items/${americano.id}`, { method: "PUT", token: alice.accessToken, body: { quantity: 2 } }),
      params({ productId: americano.id }),
    );
    expect(res.status).toBe(200);

    expect(await until(() => aliceEvents.count >= 1)).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);

    await new Promise((r) => setTimeout(r, 1_000)); // give a wrongly routed event time to arrive
    expect(bobEvents.count).toBe(0);
  });

  it("removing an item is also pushed to the owner", async () => {
    const aliceEvents = await listen(alice);

    const res = await removeItem(
      request(`/api/v1/cart/items/${americano.id}`, { method: "DELETE", token: alice.accessToken }),
      params({ productId: americano.id }),
    );
    expect(res.status).toBe(204);

    expect(await until(() => aliceEvents.count >= 1)).toBe(true);
  });

  it("the version row is readable only by its owner", async () => {
    const asBob = await realtimeClientFor(bob);
    const { data } = await asBob.from("cart_versions").select("user_id");
    expect((data ?? []).every((r: { user_id: string }) => r.user_id === bob.id)).toBe(true);

    const { data: own } = await admin().from("cart_versions").select("version").eq("user_id", alice.id).single();
    expect(own?.version).toBeGreaterThanOrEqual(2); // bumped by the PUT and the DELETE above
  });
});
