"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";
import { MAX_QUANTITY } from "@/lib/cart";

// Guest cart kept in localStorage. Prices here are for display only — the
// server recomputes every total from the products table at checkout.
const KEY = "coffee-shop:cart:v1";

const guestItem = z.object({
  productId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  imageUrl: z.string(),
  unitPriceMinor: z.number().int().positive(),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
});
export type GuestCartItem = z.infer<typeof guestItem>;

const EMPTY: GuestCartItem[] = [];
let cache: GuestCartItem[] | null = null;
const listeners = new Set<() => void>();

function load(): GuestCartItem[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    const parsed = z.array(z.unknown()).safeParse(raw);
    if (!parsed.success) return [];
    return parsed.data.flatMap((i) => {
      const item = guestItem.safeParse(i);
      return item.success ? [item.data] : [];
    });
  } catch {
    return [];
  }
}

function snapshot(): GuestCartItem[] {
  cache ??= load();
  return cache;
}

function write(next: GuestCartItem[]) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage full or blocked — keep the in-memory cart for this tab
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const clamp = (q: number) => Math.max(1, Math.min(MAX_QUANTITY, Math.trunc(q)));

export const guestCart = {
  add(item: Omit<GuestCartItem, "quantity">, quantity = 1) {
    const items = snapshot();
    const existing = items.find((i) => i.productId === item.productId);
    write(
      existing
        ? items.map((i) => (i.productId === item.productId ? { ...i, quantity: clamp(i.quantity + quantity) } : i))
        : [...items, { ...item, quantity: clamp(quantity) }],
    );
  },
  setQuantity(productId: string, quantity: number) {
    write(snapshot().map((i) => (i.productId === productId ? { ...i, quantity: clamp(quantity) } : i)));
  },
  remove(productId: string) {
    write(snapshot().filter((i) => i.productId !== productId));
  },
  clear() {
    write([]);
  },
};

export function useGuestCart() {
  const items = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  return {
    items,
    count: items.reduce((n, i) => n + i.quantity, 0),
    subtotalMinor: items.reduce((n, i) => n + i.unitPriceMinor * i.quantity, 0),
    ...guestCart,
  };
}
