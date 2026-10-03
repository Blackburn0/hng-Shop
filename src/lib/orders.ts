import { z } from "zod";
import type { Enums, Tables } from "@/lib/database.types";
import { encodeCursor, type Page } from "@/lib/pagination";
import type { Db } from "@/lib/supabase/clients";

export const deliverySchema = z
  .object({
    name: z.string().trim().min(1, "is required").max(120, "must be at most 120 characters"),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9\s-]{6,18}[0-9]$/, "must be a phone number like 0801 234 5678 or +234 801 234 5678"),
    address: z.string().trim().min(5, "must be at least 5 characters").max(500, "must be at most 500 characters"),
  })
  .strict();

export const createOrderBody = z
  .object({
    paymentMethod: z.enum(["card", "cash"], { error: 'must be "card" or "cash"' }),
    delivery: deliverySchema,
    // Where Paystack sends the payer afterwards. "app" lands on a plain page that
    // says to return to the mobile app (which checks the payment itself), instead
    // of the web processing page, which needs a web session the app doesn't have.
    returnTo: z.enum(["web", "app"], { error: 'must be "web" or "app"' }).default("web"),
  })
  .strict();

export const orderCursor = z.object({ c: z.iso.datetime({ offset: true }), id: z.uuid() });

export type OrderItem = {
  productId: string | null;
  productName: string;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
};

export type Order = {
  id: string;
  status: Enums<"order_status">;
  paymentMethod: Enums<"payment_method">;
  currency: string;
  subtotalMinor: number;
  totalMinor: number;
  customerEmail: string;
  delivery: { name: string; phone: string; address: string };
  paidAt: string | null;
  createdAt: string;
  items: OrderItem[];
};

type OrderRow = Tables<"orders"> & { order_items?: Tables<"order_items">[] };

export function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    status: row.status,
    paymentMethod: row.payment_method,
    currency: row.currency,
    subtotalMinor: row.subtotal_minor,
    totalMinor: row.total_minor,
    customerEmail: row.customer_email,
    delivery: { name: row.delivery_name, phone: row.delivery_phone, address: row.delivery_address },
    paidAt: row.paid_at,
    createdAt: row.created_at,
    items: (row.order_items ?? []).map((i) => ({
      productId: i.product_id,
      productName: i.product_name,
      unitPriceMinor: i.unit_price_minor,
      quantity: i.quantity,
      lineTotalMinor: i.line_total_minor,
    })),
  };
}

const WITH_ITEMS = "*, order_items (*)";

/** RLS scopes this to the caller: another user's order reads as null. */
export async function getOrder(db: Db, id: string): Promise<Order | null> {
  const { data, error } = await db.from("orders").select(WITH_ITEMS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toOrder(data as OrderRow) : null;
}

export async function getOrderByReference(db: Db, reference: string): Promise<Order | null> {
  const { data, error } = await db.from("orders").select(WITH_ITEMS).eq("paystack_reference", reference).maybeSingle();
  if (error) throw error;
  return data ? toOrder(data as OrderRow) : null;
}

/** The caller's orders, newest first, keyset-paginated on (created_at, id). */
export async function listOrders(
  db: Db,
  userId: string,
  { limit, cursor }: { limit: number; cursor?: z.infer<typeof orderCursor> },
): Promise<Page<Order>> {
  let query = db
    .from("orders")
    .select(WITH_ITEMS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  // Values validated by orderCursor (ISO datetime + uuid); quoted for PostgREST.
  if (cursor) query = query.or(`created_at.lt."${cursor.c}",and(created_at.eq."${cursor.c}",id.lt.${cursor.id})`);

  const { data, error } = await query;
  if (error) throw error;
  const rows = data as OrderRow[];
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    data: page.map(toOrder),
    nextCursor: rows.length > limit && last ? encodeCursor({ c: last.created_at, id: last.id }) : null,
  };
}

/** Postgres raises from create_order / mark_order_paid carry a machine-readable hint. */
export function dbHint(error: unknown): string | undefined {
  return typeof error === "object" && error && "hint" in error ? String((error as { hint: unknown }).hint) : undefined;
}
