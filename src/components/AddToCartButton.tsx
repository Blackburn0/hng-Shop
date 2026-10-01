"use client";

import { useRef, useState } from "react";
import { pillOutline } from "@/components/ui";
import { guestCart, type GuestCartItem } from "@/lib/guest-cart";

export function AddToCartButton({ product }: { product: Omit<GuestCartItem, "quantity"> }) {
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function add() {
    guestCart.add(product);
    setAdded(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(false), 1500);
  }

  return (
    <button type="button" onClick={add} className={`${pillOutline} h-12 min-w-44 border-[3px] text-lg md:text-xl`}>
      <span aria-live="polite">{added ? "Added ✓" : "Add to Cart"}</span>
      <span className="sr-only"> — {product.name}</span>
    </button>
  );
}
