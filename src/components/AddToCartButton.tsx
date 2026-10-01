"use client";

import { useRef, useState } from "react";
import { useCart } from "@/components/CartProvider";
import { pillOutline } from "@/components/ui";
import type { GuestCartItem } from "@/lib/guest-cart";

export function AddToCartButton({ product }: { product: Omit<GuestCartItem, "quantity"> }) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  async function onClick() {
    setAdded(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(false), 1500);
    await add(product);
  }

  return (
    <button type="button" onClick={onClick} className={`${pillOutline} h-12 min-w-44 border-[3px] text-lg md:text-xl`}>
      <span aria-live="polite">{added ? "Added ✓" : "Add to Cart"}</span>
      <span className="sr-only"> — {product.name}</span>
    </button>
  );
}
