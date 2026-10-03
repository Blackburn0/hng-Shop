import { z } from "zod";
import type { Db } from "@/lib/supabase/clients";

export const MAX_QUANTITY = 99;
export const MAX_MERGE_ITEMS = 50;

export const quantity = z
  .number({ error: "must be a number" })
  .int("must be a whole number")
  .min(1, "must be at least 1")
  .max(MAX_QUANTITY, `must be at most ${MAX_QUANTITY}`);

export const setQuantityBody = z.object({ quantity }).strict();

export const mergeBody = z
  .object({
    items: z
      .array(z.object({ productId: z.uuid("must be a UUID"), quantity }).strict())
      .max(MAX_MERGE_ITEMS, `must have at most ${MAX_MERGE_ITEMS} items`),
  })
  .strict();

export type CartItem = {
  productId: string;
  slug: string;
  name: string;
  imageUrl: string;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
};

export type Cart = {
  items: CartItem[];
  itemCount: number;
  subtotalMinor: number;
  currency: "NGN";
  /**
   * The cart's cart_versions.version (0 before its first change). Live-sync
   * clients ignore Realtime pushes with a version at or below this one.
   */
  version: number;
};

type Row = {
  product_id: string;
  quantity: number;
  products: { slug: string; name: string; image_url: string; price_minor: number; is_active: boolean } | null;
};

/** The caller's cart (db must act as the user). Inactive products are left out. */
export async function getCart(db: Db, userId: string): Promise<Cart> {
  // Both reads run at once, so the version adds no extra round trip.
  const [{ data, error }, versionRead] = await Promise.all([
    db
      .from("cart_items")
      .select("product_id, quantity, products (slug, name, image_url, price_minor, is_active)")
      .eq("user_id", userId)
      // Same order as the Realtime snapshot (bump_cart_version).
      .order("created_at", { ascending: true })
      .order("product_id", { ascending: true }),
    db.from("cart_versions").select("version").eq("user_id", userId).maybeSingle(),
  ]);
  if (error) throw error;
  const version = Number(versionRead.data?.version ?? 0);

  const items = (data as unknown as Row[])
    .filter((r) => r.products?.is_active)
    .map((r): CartItem => {
      const p = r.products!;
      return {
        productId: r.product_id,
        slug: p.slug,
        name: p.name,
        imageUrl: p.image_url,
        unitPriceMinor: p.price_minor,
        quantity: r.quantity,
        lineTotalMinor: p.price_minor * r.quantity,
      };
    });

  return {
    items,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    subtotalMinor: items.reduce((n, i) => n + i.lineTotalMinor, 0),
    currency: "NGN",
    version,
  };
}

/** Returns the ids from `productIds` that are active products. */
export async function activeProductIds(db: Db, productIds: string[]): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  const { data, error } = await db.from("products").select("id").in("id", productIds).eq("is_active", true);
  if (error) throw error;
  return new Set(data.map((r) => r.id));
}

/** Idempotent: sets (not adds to) the quantity. Returns false if the product isn't available. */
export async function setItemQuantity(db: Db, userId: string, productId: string, qty: number): Promise<boolean> {
  const active = await activeProductIds(db, [productId]);
  if (!active.has(productId)) return false;
  const { error } = await db
    .from("cart_items")
    .upsert({ user_id: userId, product_id: productId, quantity: qty }, { onConflict: "user_id,product_id" });
  if (error) throw error;
  return true;
}

export async function removeItem(db: Db, userId: string, productId: string): Promise<void> {
  const { error } = await db.from("cart_items").delete().eq("user_id", userId).eq("product_id", productId);
  if (error) throw error;
}

/**
 * Merge a guest cart after sign-in. For each product the larger of the two
 * quantities wins, so retrying the same merge never inflates the cart.
 * Unknown or inactive products are skipped and reported back.
 */
export async function mergeItems(
  db: Db,
  userId: string,
  incoming: { productId: string; quantity: number }[],
): Promise<{ skipped: string[] }> {
  // Collapse duplicates in the request itself.
  const wanted = new Map<string, number>();
  for (const { productId, quantity: q } of incoming) wanted.set(productId, Math.max(wanted.get(productId) ?? 0, q));

  const ids = [...wanted.keys()];
  const active = await activeProductIds(db, ids);
  const skipped = ids.filter((id) => !active.has(id));
  const keep = ids.filter((id) => active.has(id));
  if (keep.length === 0) return { skipped };

  const { data: existing, error } = await db
    .from("cart_items")
    .select("product_id, quantity")
    .eq("user_id", userId)
    .in("product_id", keep);
  if (error) throw error;
  const current = new Map(existing.map((r) => [r.product_id, r.quantity]));

  const rows = keep.map((id) => ({
    user_id: userId,
    product_id: id,
    quantity: Math.min(MAX_QUANTITY, Math.max(current.get(id) ?? 0, wanted.get(id)!)),
  }));
  const { error: upsertError } = await db.from("cart_items").upsert(rows, { onConflict: "user_id,product_id" });
  if (upsertError) throw upsertError;
  return { skipped };
}
