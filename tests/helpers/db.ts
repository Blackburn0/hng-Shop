import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";

// Every row a test creates carries this run's tag (in a slug or email) so
// cleanup can find it. Never truncate or touch untagged rows — the test suite
// shares the database with the running app (AGENTS.md).
export const TAG = `test-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;

const created = { userIds: new Set<string>(), productIds: new Set<string>() };
let seq = 0;

function env(name: string): string {
  const value = process.env[name];
  if (!value || value.includes("placeholder")) {
    throw new Error(`${name} is not set in .env.local — required for database-backed tests.`);
  }
  return value;
}

const noSession = { persistSession: false, autoRefreshToken: false };

export function admin() {
  return createClient<Database>(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: noSession,
  });
}

export type TestUser = { id: string; email: string; accessToken: string; refreshToken: string };

/** Creates a confirmed email/password user and signs them in. */
export async function createTestUser(): Promise<TestUser> {
  const email = `${TAG}-u${++seq}@example.com`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  created.userIds.add(data.user.id);

  const anon = createClient<Database>(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: noSession,
  });
  const { data: session, error: signInError } = await anon.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return {
    id: data.user.id,
    email,
    accessToken: session.session.access_token,
    refreshToken: session.session.refresh_token,
  };
}

export async function createTestProduct(
  overrides: Partial<Database["public"]["Tables"]["products"]["Insert"]> = {},
): Promise<Tables<"products">> {
  const n = ++seq;
  const { data, error } = await admin()
    .from("products")
    .insert({
      slug: `${TAG}-p${n}`,
      name: `Test product ${n}`,
      description: "Created by the test suite",
      category: "coffee",
      price_minor: 100000 + n,
      image_url: "/products/americano.jpg",
      sort_order: 1_000_000 + n, // after the real catalogue
      ...overrides,
    })
    .select()
    .single();
  if (error) throw error;
  created.productIds.add(data.id);
  return data;
}

export async function seededProduct(slug: string): Promise<Tables<"products">> {
  const { data, error } = await admin().from("products").select().eq("slug", slug).single();
  if (error) throw error;
  return data;
}

/** Deletes everything this run created. Safe to call more than once. */
export async function cleanup() {
  if (created.userIds.size === 0 && created.productIds.size === 0) return;
  const db = admin();
  const userIds = [...created.userIds];
  if (userIds.length) {
    // orders restrict user deletion; order_items and email_log cascade from orders.
    await db.from("orders").delete().in("user_id", userIds);
    for (const id of userIds) {
      const { error } = await db.auth.admin.deleteUser(id);
      if (error) throw error;
    }
  }
  await db.from("payment_events").delete().like("event_id", `%${TAG}%`);
  const productIds = [...created.productIds];
  if (productIds.length) {
    const { error } = await db.from("products").delete().in("id", productIds);
    if (error) throw error;
  }
  created.userIds.clear();
  created.productIds.clear();
}

export const unknownId = () => randomUUID();

/** Replace a user's cart with `items` (slug or product -> quantity), bypassing the API. */
export async function fillCart(user: TestUser, items: { productId: string; quantity: number }[]) {
  const db = admin();
  await db.from("cart_items").delete().eq("user_id", user.id);
  if (items.length === 0) return;
  const { error } = await db
    .from("cart_items")
    .insert(items.map((i) => ({ user_id: user.id, product_id: i.productId, quantity: i.quantity })));
  if (error) throw error;
}

export async function cartRows(user: TestUser) {
  const { data, error } = await admin().from("cart_items").select("product_id, quantity").eq("user_id", user.id);
  if (error) throw error;
  return data;
}

export async function orderRow(id: string) {
  const { data, error } = await admin().from("orders").select().eq("id", id).single();
  if (error) throw error;
  return data;
}
