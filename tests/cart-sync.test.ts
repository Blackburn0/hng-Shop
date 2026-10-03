import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as removeItem, PUT as setItem } from "@/app/api/v1/cart/items/[productId]/route";
import { GET as getCart } from "@/app/api/v1/cart/route";
import {
  parseSnapshot,
  resolveSnapshot,
  subscribeToCartChanges,
  type CartSnapshot,
  type CartSyncStatus,
} from "@/lib/cart-sync";
import type { Database, Tables } from "@/lib/database.types";
import { cleanup, createTestUser, seededProduct, type TestUser } from "./helpers/db";
import { params, request } from "./helpers/http";

// Live cart sync: cart_items change -> cart_versions bump with a snapshot of the
// items (DB trigger) -> Supabase Realtime -> subscribeToCartChanges() -> the
// client shows the pushed cart straight away (or re-reads it if it can't).

describe("parseSnapshot()", () => {
  it("accepts a cart_versions row", () => {
    expect(parseSnapshot({ version: 3, items: [{ productId: "p", quantity: 2 }], user_id: "u" })).toEqual({
      version: 3,
      items: [{ productId: "p", quantity: 2 }],
    });
  });

  it("accepts a bigint version sent as a string, and an empty cart", () => {
    expect(parseSnapshot({ version: "12", items: [] })).toEqual({ version: 12, items: [] });
  });

  it.each([
    ["no row", undefined],
    ["no items (before the snapshot migration)", { version: 2 }],
    ["items not an array", { version: 2, items: "x" }],
    ["bad version", { version: "abc", items: [] }],
    ["bad productId", { version: 1, items: [{ productId: 7, quantity: 1 }] }],
    ["zero quantity", { version: 1, items: [{ productId: "p", quantity: 0 }] }],
    ["fractional quantity", { version: 1, items: [{ productId: "p", quantity: 1.5 }] }],
    ["null item", { version: 1, items: [null] }],
  ])("rejects %s", (_, row) => {
    expect(parseSnapshot(row)).toBeNull();
  });
});

describe("resolveSnapshot()", () => {
  const catalog = new Map([
    ["a", { name: "Americano" }],
    ["c", { name: "Cappuccino" }],
  ]);

  it("pairs every item with its product, keeping order and quantities", () => {
    const snap: CartSnapshot = { version: 1, items: [{ productId: "c", quantity: 2 }, { productId: "a", quantity: 1 }] };
    expect(resolveSnapshot(snap, catalog)).toEqual([
      { product: { name: "Cappuccino" }, quantity: 2 },
      { product: { name: "Americano" }, quantity: 1 },
    ]);
  });

  it("returns null when a product isn't known, so the client re-reads the cart", () => {
    expect(resolveSnapshot({ version: 1, items: [{ productId: "zzz", quantity: 1 }] }, catalog)).toBeNull();
  });
});

describe("subscribeToCartChanges() (fake channel)", () => {
  type Handler = (payload: { new?: unknown }) => void;
  function fakeClient() {
    const state = {
      handler: undefined as Handler | undefined,
      status: undefined as ((s: string) => void) | undefined,
      removed: 0,
      filter: "",
    };
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
  const handlers = () => ({ onSnapshot: vi.fn(), onResync: vi.fn() });

  beforeEach(() => vi.useFakeTimers());

  it("listens only to the user's own row", () => {
    const { client, state } = fakeClient();
    subscribeToCartChanges(client, "user-1", handlers());
    expect(state.filter).toBe("user_id=eq.user-1");
  });

  it("applies a pushed snapshot immediately — no waiting, no API call", () => {
    const { client, state } = fakeClient();
    const h = handlers();
    subscribeToCartChanges(client, "u", h, { debounceMs: 1000 });

    state.handler!({ new: { version: 5, items: [{ productId: "p", quantity: 3 }] } });

    expect(h.onSnapshot).toHaveBeenCalledWith({ version: 5, items: [{ productId: "p", quantity: 3 }] });
    expect(h.onResync).not.toHaveBeenCalled();
  });

  it("falls back to one (debounced) re-read for pushes without a usable snapshot", () => {
    const { client, state } = fakeClient();
    const h = handlers();
    subscribeToCartChanges(client, "u", h, { debounceMs: 100 });

    state.handler!({ new: { version: 2 } });
    state.handler!({ new: { version: 3 } });
    state.handler!({});
    vi.advanceTimersByTime(99);
    expect(h.onResync).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.onResync).toHaveBeenCalledTimes(1);
    expect(h.onSnapshot).not.toHaveBeenCalled();
  });

  it("re-reads once it's (re)connected and reports its status", () => {
    const { client, state } = fakeClient();
    const h = handlers();
    const statuses: CartSyncStatus[] = [];
    subscribeToCartChanges(client, "u", h, { debounceMs: 10, onStatus: (s) => statuses.push(s) });

    state.status!("SUBSCRIBED");
    vi.advanceTimersByTime(10);
    state.status!("CHANNEL_ERROR");
    state.status!("SUBSCRIBED");
    vi.advanceTimersByTime(10);

    expect(h.onResync).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(["connecting", "live", "offline", "live"]);
  });

  it("works without a status callback", () => {
    const { client, state } = fakeClient();
    const h = handlers();
    subscribeToCartChanges(client, "u", h); // default debounce, no onStatus

    state.status!("SUBSCRIBED");
    state.status!("TIMED_OUT");
    vi.advanceTimersByTime(150);

    expect(h.onResync).toHaveBeenCalledTimes(1);
  });

  it("ignores everything after unsubscribing, including a pending re-read", () => {
    const { client, state } = fakeClient();
    const h = handlers();
    const statuses: CartSyncStatus[] = [];
    const unsubscribe = subscribeToCartChanges(client, "u", h, { debounceMs: 50, onStatus: (s) => statuses.push(s) });

    state.handler!({}); // schedules a re-read
    unsubscribe();
    state.handler!({ new: { version: 9, items: [] } });
    state.status!("SUBSCRIBED");
    vi.advanceTimersByTime(100);

    expect(h.onResync).not.toHaveBeenCalled();
    expect(h.onSnapshot).not.toHaveBeenCalled();
    expect(statuses).toEqual(["connecting"]);
    expect(state.removed).toBe(1);
  });
});

describe("live sync through Supabase Realtime (real database)", () => {
  let alice: TestUser;
  let bob: TestUser;
  let americano: Tables<"products">;
  let cappuccino: Tables<"products">;
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

  /** Subscribe and resolve once live; collect pushed snapshots (and any re-read requests after connecting). */
  async function listen(user: TestUser) {
    const client = await realtimeClientFor(user);
    const got = { snapshots: [] as CartSnapshot[], resyncs: 0 };
    let ready = false;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("realtime subscribe timed out")), 15_000);
      stops.push(
        subscribeToCartChanges(
          client,
          user.id,
          {
            onSnapshot: (s) => got.snapshots.push(s),
            onResync: () => {
              if (ready) got.resyncs++; // the first one is the catch-up after connecting
            },
          },
          {
            debounceMs: 50,
            onStatus: (s) => {
              if (s === "live") {
                clearTimeout(timeout);
                setTimeout(() => {
                  ready = true;
                  resolve();
                }, 300);
              }
            },
          },
        ),
      );
    });
    return got;
  }

  const until = async (check: () => boolean, ms = 10_000) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > ms) return false;
      await new Promise((r) => setTimeout(r, 25));
    }
    return true;
  };

  const put = (user: TestUser, product: Tables<"products">, quantity: number) =>
    setItem(
      request(`/api/v1/cart/items/${product.id}`, { method: "PUT", token: user.accessToken, body: { quantity } }),
      params({ productId: product.id }),
    );

  beforeAll(async () => {
    vi.useRealTimers();
    [alice, bob, americano, cappuccino] = await Promise.all([
      createTestUser(),
      createTestUser(),
      seededProduct("americano"),
      seededProduct("cappuccino"),
    ]);
  });
  afterAll(async () => {
    stops.forEach((stop) => stop());
    await Promise.all(clients.map((c) => c.removeAllChannels()));
    await cleanup();
  });
  beforeEach(() => vi.useRealTimers());

  it("pushes the owner's whole cart within seconds — and nothing to anyone else", async () => {
    const aliceGot = await listen(alice);
    const bobGot = await listen(bob);

    expect((await put(alice, americano, 2)).status).toBe(200);
    expect(await until(() => aliceGot.snapshots.length >= 1)).toBe(true);
    expect(aliceGot.snapshots.at(-1)!.items).toEqual([{ productId: americano.id, quantity: 2 }]);

    expect((await put(alice, cappuccino, 1)).status).toBe(200);
    expect(await until(() => aliceGot.snapshots.some((s) => s.items.length === 2))).toBe(true);
    expect(aliceGot.snapshots.at(-1)!.items).toEqual([
      { productId: americano.id, quantity: 2 },
      { productId: cappuccino.id, quantity: 1 },
    ]);
    expect(aliceGot.resyncs).toBe(0); // the snapshot was enough — no API re-read needed

    await new Promise((r) => setTimeout(r, 1_000)); // give a wrongly routed push time to arrive
    expect(bobGot.snapshots).toEqual([]);
  });

  it("pushes removals, with versions that only go up", async () => {
    const aliceGot = await listen(alice);

    const res = await removeItem(
      request(`/api/v1/cart/items/${americano.id}`, { method: "DELETE", token: alice.accessToken }),
      params({ productId: americano.id }),
    );
    expect(res.status).toBe(204);

    expect(await until(() => aliceGot.snapshots.length >= 1)).toBe(true);
    expect(aliceGot.snapshots.at(-1)!.items).toEqual([{ productId: cappuccino.id, quantity: 1 }]);
  });

  it("GET /api/v1/cart reports the same version as the latest push", async () => {
    const aliceGot = await listen(alice);
    await put(alice, cappuccino, 4);
    expect(await until(() => aliceGot.snapshots.length >= 1)).toBe(true);

    const cart = (await (await getCart(request("/api/v1/cart", { token: alice.accessToken }))).json()) as {
      version: number;
      items: { productId: string; quantity: number }[];
    };
    expect(cart.version).toBe(aliceGot.snapshots.at(-1)!.version);
    expect(cart.items.map((i) => [i.productId, i.quantity])).toEqual([[cappuccino.id, 4]]);
  });

  it("the version row is readable only by its owner", async () => {
    const asBob = await realtimeClientFor(bob);
    const { data } = await asBob.from("cart_versions").select("user_id");
    expect((data ?? []).every((r: { user_id: string }) => r.user_id === bob.id)).toBe(true);
  });
});
