"use client";

import Link from "next/link";
import { useCart } from "@/components/CartProvider";
import { CartIcon } from "@/components/icons";

export function CartLink({ className = "" }: { className?: string }) {
  const { count } = useCart();
  return (
    <Link href="/checkout" className={`relative ${className}`}>
      <CartIcon className="size-6 min-[400px]:hidden" />
      <span className="sr-only min-[400px]:not-sr-only">Checkout</span>
      {count > 0 && (
        <span
          className="absolute -right-3 -top-3 grid min-w-6 place-items-center rounded-full bg-paper px-1.5 text-sm font-bold text-espresso"
          aria-label={`${count} item${count === 1 ? "" : "s"} in cart`}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
