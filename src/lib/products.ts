import { z } from "zod";
import type { Enums, Tables } from "@/lib/database.types";
import { encodeCursor, type Page } from "@/lib/pagination";
import type { Db } from "@/lib/supabase/clients";

export const productSlug = z
  .string()
  .max(120, "is too long")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be lowercase letters, numbers and dashes");

export const productCategory = z.enum(["coffee", "pastry"]);

export const productCursor = z.object({ s: z.number().int(), id: z.uuid() });
export type ProductCursor = z.infer<typeof productCursor>;

export type Product = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: Enums<"product_category">;
  priceMinor: number;
  currency: string;
  imageUrl: string;
};

const COLUMNS = "id, slug, name, description, category, price_minor, currency, image_url, sort_order";
type ProductRow = Pick<
  Tables<"products">,
  "id" | "slug" | "name" | "description" | "category" | "price_minor" | "currency" | "image_url" | "sort_order"
>;

export function toProduct(row: Omit<ProductRow, "sort_order">): Product {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    priceMinor: row.price_minor,
    currency: row.currency,
    imageUrl: row.image_url,
  };
}

type ListOptions = { limit: number; cursor?: ProductCursor; category?: Enums<"product_category"> };

/** Active products ordered by (sort_order, id), keyset-paginated. RLS hides inactive rows. */
export async function listProducts(db: Db, { limit, cursor, category }: ListOptions): Promise<Page<Product>> {
  let query = db
    .from("products")
    .select(COLUMNS)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit + 1);

  if (category) query = query.eq("category", category);
  // Both values were validated by productCursor (int + uuid), so they are safe in a filter string.
  if (cursor) query = query.or(`sort_order.gt.${cursor.s},and(sort_order.eq.${cursor.s},id.gt.${cursor.id})`);

  const { data, error } = await query;
  if (error) throw error;

  const rows = data as ProductRow[];
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    data: page.map(toProduct),
    nextCursor: rows.length > limit && last ? encodeCursor({ s: last.sort_order, id: last.id }) : null,
  };
}

export async function getProductBySlug(db: Db, slug: string): Promise<Product | null> {
  const { data, error } = await db
    .from("products")
    .select(COLUMNS)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data ? toProduct(data) : null;
}
